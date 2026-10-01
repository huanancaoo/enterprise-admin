import { useRef, useState } from "react"
import { useParams } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import type { TFunction } from "@workspace/i18n"
import * as z from "zod"
import { ErrorState, PageHeader, PermissionDeniedState } from "@workspace/admin"
import { ApiClientError } from "@workspace/api-client"
import { authErrorMessage } from "@workspace/admin/auth"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { builtInOrganizationRoleKeys } from "@workspace/permissions"
import { authClient } from "@/lib/auth-client"
import { RoleActionDialog, type RoleAction } from "./role-action-dialog"
import {
  getOrganizationRoleAccessOptions,
  getOrganizationRolesOptions,
  organizationRolesKey,
  type OrganizationRole,
} from "@/query/organization-roles"

const rolesPath = "/app/organizations/$organizationId/roles"
type RoleTranslation = TFunction<["organization", "common", "auth"]>

const permissionLabelKeys = {
  "project:read": "rolePermission_project_read",
  "project:create": "rolePermission_project_create",
  "project:update": "rolePermission_project_update",
  "project:delete": "rolePermission_project_delete",
  "project:export": "rolePermission_project_export",
  "project:translate": "rolePermission_project_translate",
  "member:read": "rolePermission_member_read",
  "member:update": "rolePermission_member_update",
  "member:delete": "rolePermission_member_delete",
  "invitation:create": "rolePermission_invitation_create",
  "invitation:cancel": "rolePermission_invitation_cancel",
  "ac:read": "rolePermission_ac_read",
  "tenantSettings:read": "rolePermission_tenantSettings_read",
  "audit:read": "rolePermission_audit_read",
} as const

function createRoleSchema(t: RoleTranslation) {
  return z.object({
    role: z
      .string()
      .min(3, t("organization:roleNameInvalid"))
      .max(48, t("organization:roleNameInvalid"))
      .regex(/^[a-z0-9-]+$/, t("organization:roleNameInvalid"))
      .refine(
        (role) => !builtInOrganizationRoleKeys.includes(role as never),
        t("organization:roleNameInvalid")
      )
      .refine(
        (role) => !role.startsWith("platform"),
        t("organization:roleNameInvalid")
      ),
  })
}

function permissionLabel(resource: string, action: string, t: RoleTranslation) {
  const key =
    permissionLabelKeys[
      `${resource}:${action}` as keyof typeof permissionLabelKeys
    ]
  return key ? t(`organization:${key}`) : `${resource}: ${action}`
}

function RolePermissions({
  permission,
  t,
}: {
  permission: Record<string, string[]>
  t: RoleTranslation
}) {
  const items = Object.entries(permission).flatMap(([resource, actions]) =>
    actions.map((action) => permissionLabel(resource, action, t))
  )
  return (
    <span className="text-sm text-muted-foreground">
      {items.length > 0
        ? items.join("、")
        : t("organization:roleNoPermissions")}
    </span>
  )
}

export function RolesRoute() {
  const { organizationId } = useParams({ from: rolesPath })
  const { t } = useTranslation(["organization", "common", "auth"])
  const queryClient = useQueryClient()
  const [action, setAction] = useState<RoleAction | null>(null)
  const rolesTitle = useRef<HTMLHeadingElement>(null)
  const access = useQuery(getOrganizationRoleAccessOptions(organizationId))
  const roles = useQuery({
    ...getOrganizationRolesOptions(organizationId),
    enabled: access.data?.canRead === true,
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const createRole = useMutation({
    mutationFn: async (input: {
      role: string
      permission: Record<string, string[]>
    }) => {
      const result = await authClient.organization.createRole({
        organizationId,
        role: input.role,
        permission: input.permission as never,
      })
      if (result.error) {
        const code = result.error.code
        if (code === "ROLE_NAME_INVALID")
          throw new Error(t("organization:roleNameInvalid"))
        if (code === "ROLE_NAME_IS_ALREADY_TAKEN")
          throw new Error(t("organization:roleNameAlreadyTaken"))
        if (code === "ROLE_PERMISSION_NOT_DELEGABLE")
          throw new Error(t("organization:rolePermissionDenied"))
        throw new Error(
          authErrorMessage(result.error, t("common:operationFailed"))
        )
      }
    },
    onSuccess: async () => {
      setFormError(null)
      await queryClient.invalidateQueries({
        queryKey: organizationRolesKey(organizationId),
      })
    },
    onError: (error) => setFormError(error.message),
  })
  const form = useForm({
    defaultValues: { role: "" },
    validators: { onSubmit: createRoleSchema(t) },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null)
      const permission: Record<string, string[]> = {}
      for (const selected of selectedPermissions) {
        const separator = selected.lastIndexOf(":")
        const resource = selected.slice(0, separator)
        const action = selected.slice(separator + 1)
        permission[resource] = [...(permission[resource] ?? []), action]
      }
      await createRole.mutateAsync({
        role: value.role,
        permission,
      })
      formApi.reset()
      setSelectedPermissions([])
    },
  })
  if (access.isPending) return <div role="status">{t("common:loading")}</div>
  if (access.error)
    return access.error instanceof ApiClientError &&
      access.error.body.code === "FORBIDDEN" ? (
      <PermissionDeniedState />
    ) : (
      <ErrorState onRetry={() => void access.refetch()} />
    )
  if (!access.data?.canRead) return <PermissionDeniedState />

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("organization:roles")}
        description={t("organization:rolesDescription")}
      />

      <section aria-labelledby="built-in-roles-title" className="space-y-3">
        <h2 id="built-in-roles-title" className="text-lg font-semibold">
          {t("organization:builtInRoles")}
        </h2>
        <ul className="divide-y rounded-md border">
          {builtInOrganizationRoleKeys.map((role) => (
            <li
              key={role}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <span className="font-medium">
                {t(`organization:role_${role}`)}
              </span>
              <Badge variant="secondary">
                {t("organization:roleReadOnly")}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="custom-roles-title" className="space-y-3">
        <h2
          id="custom-roles-title"
          ref={rolesTitle}
          tabIndex={-1}
          className="text-lg font-semibold"
        >
          {t("organization:customRoles")}
        </h2>
        {roles.isPending ? (
          <div role="status">{t("common:loading")}</div>
        ) : roles.error ? (
          <p role="alert" className="text-sm text-destructive">
            {authErrorMessage(roles.error, t("common:operationFailed"))}
          </p>
        ) : roles.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("organization:rolesEmpty")}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {roles.data.map((role: OrganizationRole) => (
              <li key={role.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{role.role}</span>
                  <Badge variant="outline">
                    {t("organization:roleCustom")}
                  </Badge>
                </div>
                <RolePermissions permission={role.permission} t={t} />
                <p className="text-sm text-muted-foreground">
                  {t("organization:roleReferenceCounts", {
                    memberCount: role.memberCount,
                    invitationCount: role.invitationCount,
                  })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {access.data.canUpdate && (
                    <Button
                      variant="outline"
                      onClick={(event) =>
                        setAction({
                          kind: "update",
                          role,
                          grantablePermissions:
                            access.data.grantablePermissions,
                          trigger: event.currentTarget,
                        })
                      }
                    >
                      {t("organization:editRolePermissions")}
                    </Button>
                  )}
                  {access.data.canDelete && (
                    <Button
                      variant="destructive"
                      onClick={(event) =>
                        setAction({
                          kind: "delete",
                          role,
                          grantablePermissions:
                            access.data.grantablePermissions,
                          trigger: event.currentTarget,
                        })
                      }
                    >
                      {t("organization:deleteCustomRole")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {action && (
        <RoleActionDialog
          key={action.role.id + action.kind}
          organizationId={organizationId}
          action={action}
          onClose={() => setAction(null)}
          successFocus={rolesTitle}
          permissionLabel={(resource, item) =>
            permissionLabel(resource, item, t)
          }
        />
      )}
      {access.data.canCreate && (
        <section aria-labelledby="create-role-title" className="space-y-4">
          <h2 id="create-role-title" className="text-lg font-semibold">
            {t("organization:createRole")}
          </h2>
          {/* 提交包含列表读回与表单重置；期间不可编辑，避免后续输入被迟到的重置清掉。 */}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <form
                className="max-w-2xl space-y-5"
                aria-busy={submitting}
                onSubmit={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void form.handleSubmit()
                }}
              >
                <fieldset disabled={submitting} className="space-y-5">
                  <FieldGroup>
                    <form.Field name="role">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel htmlFor="custom-role-key">
                              {t("organization:roleKey")}
                            </FieldLabel>
                            <Input
                              id="custom-role-key"
                              value={field.state.value}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                              onBlur={field.handleBlur}
                              minLength={3}
                              maxLength={48}
                              autoComplete="off"
                              aria-invalid={invalid}
                              required
                            />
                            <FieldDescription>
                              {t("organization:roleKeyDescription")}
                            </FieldDescription>
                            {invalid && (
                              <FieldError errors={field.state.meta.errors} />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>

                    <Field data-slot="checkbox-group">
                      <FieldLabel>
                        {t("organization:rolePermissions")}
                      </FieldLabel>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {(access.data?.grantablePermissions ?? []).map(
                          ({ resource, action }) => {
                            const key = `${resource}:${action}`
                            const checked = selectedPermissions.includes(key)
                            return (
                              <label
                                key={key}
                                className="flex items-center gap-2 text-sm"
                              >
                                <Checkbox
                                  checked={checked}
                                  disabled={submitting}
                                  onCheckedChange={(value) =>
                                    setSelectedPermissions((current) =>
                                      value === true
                                        ? [...current, key]
                                        : current.filter((item) => item !== key)
                                    )
                                  }
                                />
                                {permissionLabel(resource, action, t)}
                              </label>
                            )
                          }
                        )}
                      </div>
                    </Field>
                  </FieldGroup>

                  {formError && (
                    <p role="alert" className="text-sm text-destructive">
                      {formError}
                    </p>
                  )}
                  <Button type="submit" disabled={submitting}>
                    {submitting
                      ? t("common:loading")
                      : t("organization:createRole")}
                  </Button>
                </fieldset>
              </form>
            )}
          </form.Subscribe>
        </section>
      )}
    </div>
  )
}
