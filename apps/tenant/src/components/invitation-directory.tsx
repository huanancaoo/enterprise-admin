import { useEffect, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { FormDialog, ConfirmDangerAction } from "@workspace/admin"
import { authErrorMessage } from "@workspace/admin/auth"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
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
  getInvitationDirectoryOptions,
  invitationDirectoryKey,
  MemberDirectoryError,
  type InvitationRow,
} from "@/query/organization-directory"
import { getOrganizationRolesOptions } from "@/query/organization-roles"

function invitationSchema(emailMessage: string, roleMessage: string) {
  return z.object({
    email: z.email(emailMessage),
    role: z.string().min(1, roleMessage),
  })
}

export function InvitationDirectory({
  organizationId,
  actorRole,
}: {
  organizationId: string
  actorRole: string
}) {
  const { t } = useTranslation(["organization", "common", "auth", "validation"])
  const locale = useUiLocale()
  const queryClient = useQueryClient()
  const directoryTitle = useRef<HTMLHeadingElement>(null)
  const resendTrigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<{
    resend: boolean
    delivery: InvitationRow["delivery"]
  }>()
  const access = useQuery({
    queryKey: [...invitationDirectoryKey(organizationId), "access"],
    queryFn: async () => {
      const check = async (action: "create" | "cancel") => {
        const result = await authClient.organization.hasPermission({
          organizationId,
          permissions: { invitation: [action] },
        })
        if (result.error)
          throw new Error(
            authErrorMessage(result.error, t("common:operationFailed"))
          )
        return result.data.success
      }
      const [create, cancel] = await Promise.all([
        check("create"),
        check("cancel"),
      ])
      return { create, cancel }
    },
    retry: false,
  })
  const canRead = Boolean(access.data?.create || access.data?.cancel)
  const invitations = useQuery({
    ...getInvitationDirectoryOptions(organizationId),
    enabled: canRead,
    retry: false,
  })
  const canListRoles = actorRole === "owner" || actorRole === "admin"
  const roles = useQuery({
    ...getOrganizationRolesOptions(organizationId),
    enabled: Boolean(access.data?.create) && canListRoles,
  })
  useEffect(() => {
    if (
      invitations.error instanceof MemberDirectoryError &&
      invitations.error.status === 403
    ) {
      queryClient.removeQueries({
        queryKey: invitationDirectoryKey(organizationId),
        exact: true,
      })
      void queryClient.invalidateQueries({
        queryKey: [...invitationDirectoryKey(organizationId), "access"],
      })
    }
  }, [invitations.error, organizationId, queryClient])
  const statusLabels = {
    pending: t("organization:invitation_pending"),
    accepted: t("organization:invitation_accepted"),
    rejected: t("organization:invitation_rejected"),
    canceled: t("organization:invitation_canceled"),
    expired: t("organization:invitation_expired"),
  }
  const deliveryLabels = {
    pending: t("organization:delivery_pending"),
    smtp_accepted: t("organization:delivery_smtp_accepted"),
    failed: t("organization:delivery_failed"),
    unknown: t("organization:delivery_unknown"),
  }
  async function refresh(id?: string, resend = false) {
    // 原生写已经提交；后续读取失败只影响结果展示，不能把创建成功变成表单提交失败。
    if (id) setNotice({ resend, delivery: null })
    try {
      const rows = await queryClient.query({
        ...getInvitationDirectoryOptions(organizationId),
        staleTime: 0,
      })
      if (id)
        setNotice({
          resend,
          delivery: rows.find((row) => row.id === id)?.delivery ?? null,
        })
    } catch {
      // 查询状态保存读取错误，由列表的 alert 展示；创建结果仍保持成功。
    }
    void queryClient.invalidateQueries({
      queryKey: ["organizations", organizationId, "access"],
    })
  }
  const send = useMutation({
    mutationFn: async (input: {
      email: string
      role: string
      resend?: boolean
    }) => {
      const result = await authClient.organization.inviteMember({
        ...input,
        organizationId,
      })
      if (result.error)
        throw new Error(
          authErrorMessage(result.error, t("common:operationFailed"))
        )
      return result.data.id
    },
    onSuccess: (id, input) => refresh(id, Boolean(input.resend)),
  })
  useEffect(() => {
    if (send.isPending || !resendTrigger.current) return
    const trigger = resendTrigger.current
    resendTrigger.current = null
    // 禁用会使浏览器失去按钮焦点；用户已经转到其他控件时不抢回焦点。
    if (document.activeElement === document.body) trigger.focus()
  }, [send.isPending, send.status])
  const cancel = useMutation({
    mutationFn: async (invitationId: string) => {
      const result = await authClient.organization.cancelInvitation({
        invitationId,
      })
      if (result.error)
        throw new Error(
          authErrorMessage(result.error, t("common:operationFailed"))
        )
    },
    onSuccess: () => refresh(),
  })
  useEffect(() => {
    // 成功取消后行内按钮和确认层都会移除，焦点回到仍存在的目录标题。
    if (cancel.isSuccess) directoryTitle.current?.focus()
  }, [cancel.isSuccess])
  const form = useForm({
    defaultValues: { email: "", role: "member" },
    validators: {
      onSubmit: invitationSchema(
        t("validation:email"),
        t("organization:roleRequired")
      ),
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await send.mutateAsync({ email: value.email, role: value.role })
      } catch {
        // mutation 保存服务端错误供表单展示；失败提交在此结束，保留原草稿。
        return
      }
      formApi.reset()
      setOpen(false)
    },
  })
  const roleOptions = [
    "member",
    ...(actorRole === "owner" ? ["admin"] : []),
    ...(roles.data ?? []).map((role) => role.role),
  ]
  const roleLabel = (role: string) =>
    role === "member"
      ? t("organization:role_member")
      : role === "admin"
        ? t("organization:role_admin")
        : role
  if (access.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("common:loading")}
      </p>
    )
  if (access.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {access.error.message}
      </p>
    )
  if (!canRead) return null
  return (
    <section
      className="min-w-0 space-y-4 border-t pt-6"
      aria-labelledby="invitation-directory-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          ref={directoryTitle}
          id="invitation-directory-title"
          tabIndex={-1}
          className="text-lg font-semibold"
        >
          {t("organization:invitations")}
        </h2>
        {access.data?.create && (
          <Button
            onClick={() => {
              send.reset()
              setOpen(true)
            }}
          >
            {t("organization:invite")}
          </Button>
        )}
      </div>
      {notice !== undefined && (
        <p
          role={
            notice.delivery?.status === "failed" ||
            notice.delivery?.status === "unknown"
              ? "alert"
              : "status"
          }
        >
          {notice.resend
            ? t("organization:invitationResent")
            : t("organization:invitationCreated")}{" "}
          {notice.delivery
            ? deliveryLabels[notice.delivery.status]
            : t("organization:delivery_unrecorded")}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {t("organization:smtpAcceptanceNotice")}
      </p>
      {invitations.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("common:loading")}
        </p>
      )}
      {invitations.error && (
        <p role="alert" className="text-sm text-destructive">
          {invitations.error.message}
        </p>
      )}
      {send.error && !open && (
        <p role="alert" className="text-sm text-destructive">
          {send.error.message}
        </p>
      )}
      {invitations.data && !invitations.error && (
        <ul
          aria-label={t("organization:invitations")}
          className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm"
        >
          {invitations.data.length === 0 && (
            <li className="p-4 text-muted-foreground">
              {t("organization:noInvitations")}
            </li>
          )}
          {invitations.data.map((invitation) => {
            const manageable =
              invitation.role !== "admin" || actorRole === "owner"
            return (
              <li
                key={invitation.id}
                className="flex flex-col items-start justify-between gap-4 p-4 sm:flex-row sm:p-5"
              >
                <div className="min-w-0 flex-1 space-y-1.5 text-sm text-muted-foreground">
                  <p
                    dir="ltr"
                    className="font-medium wrap-anywhere text-foreground"
                  >
                    {invitation.email}
                  </p>
                  <p>
                    {roleLabel(invitation.role)} ·{" "}
                    {statusLabels[invitation.businessStatus]}
                  </p>
                  <p>
                    <span>{t("organization:inviter")}</span>{" "}
                    {invitation.inviterName}
                  </p>
                  <p>
                    <span>{t("organization:invitationCreatedAt")}</span>{" "}
                    <time
                      dateTime={new Date(invitation.createdAt).toISOString()}
                    >
                      {createFormatter(locale).dateTime(
                        new Date(invitation.createdAt),
                        "UTC"
                      )}
                    </time>
                  </p>
                  <p>
                    <span>{t("organization:invitationExpiresAt")}</span>{" "}
                    <time
                      dateTime={new Date(invitation.expiresAt).toISOString()}
                    >
                      {createFormatter(locale).dateTime(
                        new Date(invitation.expiresAt),
                        "UTC"
                      )}
                    </time>
                  </p>
                  <p>
                    <span>{t("organization:deliveryStatus")}</span>{" "}
                    {invitation.delivery
                      ? deliveryLabels[invitation.delivery.status]
                      : t("organization:delivery_unrecorded")}
                  </p>
                </div>
                {invitation.businessStatus === "pending" && manageable && (
                  <div className="flex w-full flex-wrap gap-2 border-t pt-3 sm:w-auto sm:justify-end sm:border-0 sm:pt-0">
                    {access.data?.create && (
                      <Button
                        variant="outline"
                        disabled={send.isPending}
                        onClick={(event) => {
                          resendTrigger.current = event.currentTarget
                          send.mutate({
                            email: invitation.email,
                            role: invitation.role,
                            resend: true,
                          })
                        }}
                      >
                        {t("organization:resend")}
                      </Button>
                    )}
                    {access.data?.cancel && (
                      <ConfirmDangerAction
                        triggerLabel={t("organization:cancelInvitation")}
                        title={t("organization:cancelInvitationTitle")}
                        description={t(
                          "organization:cancelInvitationDescription",
                          { email: invitation.email }
                        )}
                        cancelLabel={t("common:cancel")}
                        confirmLabel={t("organization:cancelInvitation")}
                        pendingLabel={t("organization:cancelling")}
                        pending={cancel.isPending}
                        error={cancel.error?.message}
                        onOpenChange={(nextOpen) => {
                          if (nextOpen) cancel.reset()
                        }}
                        onConfirm={() => cancel.mutate(invitation.id)}
                      />
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <FormDialog
            open={open}
            onOpenChange={setOpen}
            title={t("organization:invite")}
            description={t("organization:inviteDescription")}
            onSubmit={() => void form.handleSubmit()}
            pending={send.isPending || submitting}
            error={send.error?.message}
            submitLabel={t("organization:inviteSubmit")}
          >
            <FieldGroup>
              <form.Field name="email">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor="invite-email">
                        {t("auth:email")}
                      </FieldLabel>
                      <Input
                        id="invite-email"
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        type="email"
                        autoComplete="email"
                        dir="ltr"
                        required
                        aria-invalid={invalid}
                      />
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="role">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor="invite-role">
                        {t("organization:role")}
                      </FieldLabel>
                      {canListRoles ? (
                        <Select
                          value={field.state.value}
                          items={Object.fromEntries(
                            roleOptions.map((role) => [role, roleLabel(role)])
                          )}
                          onValueChange={(value) => {
                            if (value !== null) field.handleChange(value)
                          }}
                        >
                          <SelectTrigger
                            id="invite-role"
                            onBlur={field.handleBlur}
                            aria-invalid={invalid}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {roleOptions.map((role) => (
                              <SelectItem key={role} value={role}>
                                {roleLabel(role)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id="invite-role"
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          onBlur={field.handleBlur}
                          required
                          aria-invalid={invalid}
                        />
                      )}
                      {canListRoles && roles.isPending && (
                        <p
                          role="status"
                          className="text-sm text-muted-foreground"
                        >
                          {t("common:loading")}
                        </p>
                      )}
                      {canListRoles && roles.error && (
                        <p role="alert" className="text-sm text-destructive">
                          {roles.error.message}
                        </p>
                      )}
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
            </FieldGroup>
          </FormDialog>
        )}
      </form.Subscribe>
    </section>
  )
}
