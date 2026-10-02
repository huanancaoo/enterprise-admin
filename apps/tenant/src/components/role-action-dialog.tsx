import { useState, type RefObject } from "react"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { FormDialog } from "@workspace/admin"
import { organizationKeys } from "@workspace/api-client"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { authClient } from "@/lib/auth-client"
import {
  OrganizationMutationError,
  organizationWriteOptions,
} from "@/lib/organization-mutations"
import type {
  OrganizationRole,
  RolePermission,
} from "@/query/organization-roles"

const permissionSchema = z.object({ permissions: z.array(z.string()) })

export type RoleAction = {
  kind: "update" | "delete"
  role: OrganizationRole
  grantablePermissions: RolePermission[]
  trigger: HTMLButtonElement
}

export function RoleActionDialog({
  organizationId,
  action,
  onClose,
  successFocus,
  permissionLabel,
}: {
  organizationId: string
  action: RoleAction
  onClose: () => void
  successFocus: RefObject<HTMLElement | null>
  permissionLabel: (resource: string, action: string) => string
}) {
  const { t } = useTranslation(["organization", "common"])
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(true)
  const role = action.role
  const mutation = useMutation({
    mutationFn: async (permissions: string[]) => {
      const permission: Record<string, string[]> = {}
      for (const key of permissions) {
        const separator = key.lastIndexOf(":")
        const resource = key.slice(0, separator)
        permission[resource] = [
          ...(permission[resource] ?? []),
          key.slice(separator + 1),
        ]
      }
      // 固定打开窗口时的版本；刷新列表不能代替管理员确认新的影响范围。
      const options = organizationWriteOptions(role.authorizationVersion)
      const result =
        action.kind === "update"
          ? await authClient.organization.updateRole({
              organizationId,
              roleId: role.id,
              data: { permission: permission as never },
              ...options,
            })
          : await authClient.organization.deleteRole({
              organizationId,
              roleId: role.id,
              ...options,
            })
      if (result.error) {
        if (result.error.code === "ROLE_PERMISSION_NOT_DELEGABLE")
          throw new Error(t("organization:rolePermissionDenied"))
        if (result.error.code === "ROLE_IN_USE") {
          const error = result.error as typeof result.error & {
            memberCount: number
            invitationCount: number
          }
          throw new Error(
            t("organization:roleInUse", {
              memberCount: error.memberCount,
              invitationCount: error.invitationCount,
            })
          )
        }
        throw new OrganizationMutationError(
          result.error,
          t("common:operationFailed")
        )
      }
    },
    onSuccess: async () => {
      await queryClient.cancelQueries({
        queryKey: organizationKeys.scope(organizationId),
      })
      await queryClient.invalidateQueries({
        queryKey: organizationKeys.scope(organizationId),
      })
      setOpen(false)
    },
    onError: async () => {
      await queryClient.invalidateQueries({
        queryKey: organizationKeys.scope(organizationId),
      })
    },
  })
  const stale =
    mutation.error instanceof OrganizationMutationError &&
    mutation.error.code === "AUTHORIZATION_VERSION_CONFLICT"
  const form = useForm({
    defaultValues: {
      permissions: Object.entries(role.permission).flatMap(
        ([resource, actions]) => actions.map((item) => `${resource}:${item}`)
      ),
    },
    validators: { onSubmit: permissionSchema },
    onSubmit: ({ value }) => mutation.mutate(value.permissions),
  })
  // 当前不可委派的已有权限仍可取消，不能静默从草稿丢弃它们或重新授予。
  const permissions = [...action.grantablePermissions]
  for (const [resource, actions] of Object.entries(role.permission)) {
    for (const item of actions) {
      if (
        !permissions.some(
          (entry) => entry.resource === resource && entry.action === item
        )
      )
        permissions.push({ resource, action: item })
    }
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(value) => {
        if (!value) onClose()
      }}
      title={
        action.kind === "update"
          ? t("organization:editRolePermissions")
          : t("organization:deleteCustomRole")
      }
      description={
        action.kind === "update"
          ? t("organization:editRoleDescription", { role: role.role })
          : t("organization:deleteRoleDescription", { role: role.role })
      }
      onSubmit={() => void form.handleSubmit()}
      pending={mutation.isPending}
      submitDisabled={stale}
      submitLabel={
        action.kind === "update"
          ? t("organization:confirmRoleUpdate")
          : t("organization:confirmRoleDelete")
      }
      error={stale ? t("organization:roleChanged") : mutation.error?.message}
      finalFocus={() =>
        action.trigger.isConnected ? action.trigger : successFocus.current
      }
    >
      <p>
        {t("organization:roleReferenceCounts", {
          memberCount: role.memberCount,
          invitationCount: role.invitationCount,
        })}
      </p>
      {action.kind === "update" && (
        <form.Field name="permissions" mode="array">
          {(field) => {
            const invalid =
              field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={invalid}>
                <FieldLabel>{t("organization:rolePermissions")}</FieldLabel>
                <FieldGroup data-slot="checkbox-group">
                  {permissions.map(({ resource, action: item }) => {
                    const key = `${resource}:${item}`
                    const index = field.state.value.indexOf(key)
                    const grantable = action.grantablePermissions.some(
                      (entry) =>
                        entry.resource === resource && entry.action === item
                    )
                    return (
                      <label
                        key={key}
                        className="flex items-center gap-2 text-sm"
                      >
                        {/* 非原生复选框的键盘处理不会继承 fieldset 的 disabled。 */}
                        <Checkbox
                          checked={index >= 0}
                          aria-invalid={invalid}
                          onBlur={field.handleBlur}
                          disabled={
                            mutation.isPending || (!grantable && index < 0)
                          }
                          onCheckedChange={(checked) => {
                            if (checked === true) field.pushValue(key)
                            else field.removeValue(index)
                          }}
                        />
                        {permissionLabel(resource, item)}
                      </label>
                    )
                  })}
                </FieldGroup>
                {invalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>
      )}
    </FormDialog>
  )
}
