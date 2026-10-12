import { useId, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import type { TFunction } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { useAuthenticatedSession } from "../auth/authenticated-session"
import { useAuthAction } from "../auth/use-auth-action"
import { ConfirmDangerAction } from "./confirm-danger-action"
import type { WorkspaceAuthClient } from "../auth/client"

function passwordSchema(t: TFunction<["settings", "validation", "common"]>) {
  return z
    .object({
      currentPassword: z.string().min(1, t("validation:passwordRequired")),
      newPassword: z
        .string()
        .min(12, t("validation:passwordMin"))
        .max(128, t("validation:passwordMax")),
      confirmPassword: z.string(),
    })
    .refine((value) => value.newPassword === value.confirmPassword, {
      path: ["confirmPassword"],
      message: t("validation:passwordMismatch"),
    })
}

function emailSchema(t: TFunction<["settings", "validation", "common"]>) {
  return z.object({ newEmail: z.email(t("validation:email")) })
}

export function PersonalSecuritySettings({
  client,
}: {
  client: WorkspaceAuthClient
}) {
  const { t } = useTranslation(["settings", "validation", "common"])
  const locale = useUiLocale()
  const id = useId()
  const user = useAuthenticatedSession()!.user
  const nativeSession = client.useSession()
  const queryClient = useQueryClient()
  const sessionsKey = ["account-security", user.id, "sessions"] as const
  const sessions = useQuery({
    queryKey: sessionsKey,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const result = await client.listSessions()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })
  const password = useAuthAction()
  const [passwordSaved, setPasswordSaved] = useState(false)
  const form = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    validators: { onSubmit: passwordSchema(t) },
    onSubmit: async ({ value, formApi }) => {
      setPasswordSaved(false)
      if (
        !(await password.run(() =>
          client.changePassword({
            currentPassword: value.currentPassword,
            newPassword: value.newPassword,
            revokeOtherSessions: true,
          })
        ))
      )
        return
      // 原生认证轮换当前 Cookie；平台不能把旧 Session 的 MFA 事实带到新会话。
      await nativeSession.refetch({ query: { disableCookieCache: true } })
      await queryClient.invalidateQueries({ queryKey: sessionsKey })
      formApi.reset()
      setPasswordSaved(true)
    },
  })
  const email = useAuthAction()
  const [requestedEmail, setRequestedEmail] = useState<string>()
  const emailForm = useForm({
    defaultValues: { newEmail: "" },
    validators: { onSubmit: emailSchema(t) },
    onSubmit: async ({ value, formApi }) => {
      setRequestedEmail(undefined)
      if (
        !(await email.run(() =>
          client.changeEmail({
            newEmail: value.newEmail,
            callbackURL: `${window.location.origin}/auth/verified`,
          })
        ))
      )
        return
      // 请求成功只表示原生验证邮件已发送；当前用户邮箱以 Session 读回为准。
      setRequestedEmail(value.newEmail)
      formApi.reset()
    },
  })
  const revoke = useAuthAction()
  const [revokingId, setRevokingId] = useState<string>()
  const [sessionRevoked, setSessionRevoked] = useState(false)
  const revokeSession = async (token: string, current: boolean) => {
    setSessionRevoked(false)
    if (
      !(await revoke.run(() =>
        current ? client.signOut() : client.revokeSession({ token })
      ))
    )
      return
    setRevokingId(undefined)
    if (current) {
      queryClient.removeQueries({ queryKey: sessionsKey })
      await nativeSession.refetch({ query: { disableCookieCache: true } })
    } else {
      await queryClient.invalidateQueries({ queryKey: sessionsKey })
      setSessionRevoked(true)
    }
  }
  const fields = [
    {
      name: "currentPassword",
      label: t("currentPassword"),
      autoComplete: "current-password",
    },
    {
      name: "newPassword",
      label: t("newPassword"),
      autoComplete: "new-password",
    },
    {
      name: "confirmPassword",
      label: t("confirmNewPassword"),
      autoComplete: "new-password",
    },
  ] as const
  return (
    <div className="space-y-6">
      <section
        aria-labelledby={`${id}-password-title`}
        className="space-y-4 rounded-xl border p-4"
      >
        <h2 id={`${id}-password-title`} className="text-lg font-semibold">
          {t("passwordTitle")}
        </h2>
        <FieldDescription>{t("passwordChangeHint")}</FieldDescription>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(pending) => (
            <form
              aria-busy={pending}
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void form.handleSubmit()
              }}
            >
              <fieldset disabled={pending} className="space-y-4">
                <FieldGroup>
                  {fields.map((config) => (
                    <form.Field key={config.name} name={config.name}>
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel htmlFor={`${id}-${config.name}`}>
                              {config.label}
                            </FieldLabel>
                            <Input
                              id={`${id}-${config.name}`}
                              name={field.name}
                              type="password"
                              autoComplete={config.autoComplete}
                              required
                              maxLength={128}
                              minLength={
                                config.name === "currentPassword" ? 1 : 12
                              }
                              aria-invalid={invalid}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                            />
                            {invalid && (
                              <FieldError errors={field.state.meta.errors} />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                  ))}
                </FieldGroup>
                {password.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {password.error}
                  </p>
                )}
                {passwordSaved && <p role="status">{t("passwordChanged")}</p>}
                <Button type="submit">
                  {pending ? t("saving") : t("changePassword")}
                </Button>
              </fieldset>
            </form>
          )}
        </form.Subscribe>
      </section>
      <section
        aria-labelledby={`${id}-email-title`}
        className="space-y-4 rounded-xl border p-4"
      >
        <h2 id={`${id}-email-title`} className="text-lg font-semibold">
          {t("emailTitle")}
        </h2>
        <p>{user.email}</p>
        <emailForm.Subscribe selector={(state) => state.isSubmitting}>
          {(pending) => (
            <form
              aria-busy={pending}
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void emailForm.handleSubmit()
              }}
            >
              <fieldset disabled={pending} className="space-y-4">
                <emailForm.Field name="newEmail">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${id}-new-email`}>
                          {t("newEmail")}
                        </FieldLabel>
                        <Input
                          id={`${id}-new-email`}
                          name={field.name}
                          type="email"
                          autoComplete="email"
                          required
                          aria-invalid={invalid}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                        />
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </emailForm.Field>
                {email.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {email.error}
                  </p>
                )}
                {requestedEmail && (
                  <p role="status">
                    {t("emailVerificationSent", { email: requestedEmail })}
                  </p>
                )}
                <Button type="submit">
                  {pending ? t("saving") : t("changeEmail")}
                </Button>
              </fieldset>
            </form>
          )}
        </emailForm.Subscribe>
      </section>
      <section
        aria-labelledby={`${id}-sessions-title`}
        className="space-y-4 rounded-xl border p-4"
      >
        <h2 id={`${id}-sessions-title`} className="text-lg font-semibold">
          {t("sessionsTitle")}
        </h2>
        {sessions.isPending && <p role="status">{t("common:loading")}</p>}
        {sessions.isError && (
          <div>
            <p role="alert" className="text-destructive">
              {t("sessionsLoadError")}
            </p>
            <Button onClick={() => void sessions.refetch()}>
              {t("common:retry")}
            </Button>
          </div>
        )}
        {revoke.error && (
          <p role="alert" className="text-destructive">
            {revoke.error}
          </p>
        )}
        {sessionRevoked && <p role="status">{t("sessionRevoked")}</p>}
        {sessions.data && (
          <ul className="space-y-3">
            {sessions.data.map((item) => (
              <li
                key={item.id}
                className="space-y-1 rounded-lg border p-3 text-sm"
              >
                <p className="[overflow-wrap:anywhere]">
                  {item.userAgent || t("unknownDevice")}
                </p>
                {item.id === nativeSession.data?.session.id && (
                  <p className="font-medium">{t("currentSession")}</p>
                )}
                <dl className="flex flex-wrap gap-x-6 gap-y-1">
                  <div>
                    <dt className="text-muted-foreground">
                      {t("sessionAddress")}
                    </dt>
                    <dd>{item.ipAddress || t("unknownAddress")}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t("sessionCreated")}
                    </dt>
                    <dd>
                      {new Date(item.createdAt).toLocaleString(locale, {
                        timeZone: "UTC",
                      })}
                    </dd>
                  </div>
                </dl>
                <ConfirmDangerAction
                  triggerLabel={t("revokeSession")}
                  title={t("revokeSessionTitle")}
                  description={
                    item.id === nativeSession.data?.session.id
                      ? t("revokeCurrentHint")
                      : t("revokeSessionHint")
                  }
                  cancelLabel={t("common:cancel")}
                  confirmLabel={t("signOutSession")}
                  pendingLabel={t("saving")}
                  pending={revoke.pending}
                  open={revokingId === item.id}
                  onOpenChange={(open) => {
                    setRevokingId(open ? item.id : undefined)
                    revoke.reset()
                  }}
                  onConfirm={() =>
                    void revokeSession(
                      item.token,
                      item.id === nativeSession.data?.session.id
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
