import { useForm } from "@tanstack/react-form"
import { useRef, useState, type RefObject } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { FormDialog } from "@workspace/admin"
import {
  dropOrganizationQueries,
  organizationKeys,
} from "@workspace/api-client"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { authClient } from "@/lib/auth-client"
import {
  OrganizationMutationError,
  organizationWriteOptions,
} from "@/lib/organization-mutations"
import type { MemberRow } from "@/query/organization-directory"

const roleSchema = z.object({ role: z.enum(["member", "admin", "owner"]) })
type Role = z.infer<typeof roleSchema>["role"]

export type MemberAction = (
  { kind: "role" | "remove"; member: MemberRow } | { kind: "leave" }
) & { authorizationVersion: number; trigger: HTMLButtonElement }

export function MemberActionDialog({
  organizationId,
  actorRole,
  action,
  onClose,
  successFocus,
}: {
  organizationId: string
  actorRole: string
  action: MemberAction
  onClose: () => void
  successFocus: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation(["organization", "common"])
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const completed = useRef(false)
  const [open, setOpen] = useState(true)
  const mutation = useMutation({
    mutationFn: async (role: Role) => {
      // 使用打开确认窗口时的版本，避免后台刷新替用户接受已变化的授权事实。
      const options = organizationWriteOptions(action.authorizationVersion)
      const result =
        action.kind === "role"
          ? await authClient.organization.updateMemberRole({
              organizationId,
              memberId: action.member.id,
              role,
              ...options,
            })
          : action.kind === "remove"
            ? await authClient.organization.removeMember({
                organizationId,
                memberIdOrEmail: action.member.id,
                ...options,
              })
            : await authClient.organization.leave({
                organizationId,
                ...options,
              })
      if (result.error)
        throw new OrganizationMutationError(
          result.error,
          t("common:operationFailed")
        )
    },
    onSuccess: async () => {
      if (action.kind === "leave") {
        onClose()
        dropOrganizationQueries(queryClient, organizationId)
        await queryClient.invalidateQueries({
          queryKey: organizationKeys.mine(),
        })
        await navigate({ to: "/app/select-organization" })
      } else {
        await queryClient.cancelQueries({
          queryKey: organizationKeys.scope(organizationId),
        })
        await queryClient.invalidateQueries({
          queryKey: organizationKeys.scope(organizationId),
        })
        // 先读回成员列表，再关闭窗口；消失的操作按钮不能作为焦点恢复目标。
        completed.current = true
        setOpen(false)
      }
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
  const initialRole =
    action.kind === "role" &&
    (action.member.role === "admin" || action.member.role === "owner")
      ? action.member.role
      : "member"
  const form = useForm({
    defaultValues: { role: initialRole as Role },
    validators: { onSubmit: roleSchema },
    onSubmit: ({ value }) => mutation.mutate(value.role),
  })
  const title =
    action.kind === "role"
      ? t("organization:updateRole")
      : action.kind === "remove"
        ? t("organization:removeMemberTitle")
        : t("organization:leaveTitle")
  const description =
    action.kind === "role"
      ? t("organization:updateRoleDescription", {
          name: action.member.user.name,
        })
      : action.kind === "remove"
        ? t("organization:removeMemberDescription", {
            name: action.member.user.name,
          })
        : t("organization:leaveDescription")
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(open) => {
        if (!open) onClose()
      }}
      title={title}
      description={description}
      onSubmit={() => void form.handleSubmit()}
      pending={mutation.isPending}
      submitDisabled={stale}
      finalFocus={() => {
        if (!completed.current) return true
        return action.trigger.isConnected
          ? action.trigger
          : successFocus.current
      }}
      error={
        stale ? t("organization:membershipChanged") : mutation.error?.message
      }
      submitLabel={
        action.kind === "role"
          ? t("common:save")
          : action.kind === "remove"
            ? t("organization:removeMember")
            : t("organization:leave")
      }
    >
      {action.kind === "role" && (
        <FieldGroup>
          <form.Field name="role">
            {(field) => {
              const isInvalid =
                field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor="member-new-role">
                    {t("organization:role")}
                  </FieldLabel>
                  <Select
                    value={field.state.value}
                    items={{
                      member: t("organization:role_member"),
                      admin: t("organization:role_admin"),
                      owner: t("organization:role_owner"),
                    }}
                    onValueChange={(role) => {
                      if (
                        role === "member" ||
                        role === "admin" ||
                        role === "owner"
                      )
                        field.handleChange(role)
                    }}
                  >
                    <SelectTrigger
                      id="member-new-role"
                      onBlur={field.handleBlur}
                      aria-invalid={isInvalid}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">
                        {t("organization:role_member")}
                      </SelectItem>
                      {actorRole === "owner" && (
                        <SelectItem value="admin">
                          {t("organization:role_admin")}
                        </SelectItem>
                      )}
                      {actorRole === "owner" && (
                        <SelectItem value="owner">
                          {t("organization:role_owner")}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
          <p className="text-sm text-muted-foreground">
            {t("organization:ownershipHint")}
          </p>
        </FieldGroup>
      )}
    </FormDialog>
  )
}
