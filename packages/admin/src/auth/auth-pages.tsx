import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "@workspace/i18n"
import { useForm } from "@tanstack/react-form"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import * as z from "zod"
import { AuthPageShell } from "./auth-page-shell"
import { useWorkspaceAuthClient } from "./auth-client-context"
import { useAuthAction } from "./use-auth-action"
import { useAuthenticatedSession } from "./authenticated-session"

export function ForgotPasswordPage({ title }: { title: string }) {
  const { t } = useTranslation(["auth", "common", "validation"])
  const client = useWorkspaceAuthClient()
  const action = useAuthAction()
  const [submitted, setSubmitted] = useState(false)
  const form = useForm({
    defaultValues: { email: "" },
    validators: {
      onSubmit: z.object({ email: z.email(t("validation:email")) }),
    },
    onSubmit: async ({ value }) => {
      const ok = await action.run(() =>
        client.requestPasswordReset({
          email: value.email.trim(),
          redirectTo: `${window.location.origin}/reset-password`,
        })
      )
      if (ok) setSubmitted(true)
    },
  })
  return (
    <AuthPageShell title={title}>
      {submitted ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-bold">
            {t("auth:forgotPasswordTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("auth:forgotPasswordSubmitted")}
          </p>
          <Button
            nativeButton={false}
            variant="link"
            render={<Link to="/login" />}
          >
            {t("auth:backToSignIn")}
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
          className="flex flex-col gap-6"
          aria-busy={action.pending}
        >
          <fieldset disabled={action.pending} className="contents">
            <FieldGroup>
              <div className="flex flex-col items-center gap-1 text-center">
                <h1 className="text-2xl font-bold">
                  {t("auth:forgotPasswordTitle")}
                </h1>
                <p className="text-sm text-balance text-muted-foreground">
                  {t("auth:forgotPasswordDescription")}
                </p>
              </div>
              <form.Field name="email">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor="forgot-email">
                        {t("auth:email")}
                      </FieldLabel>
                      <Input
                        id="forgot-email"
                        name={field.name}
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        type="email"
                        autoComplete="email"
                        aria-invalid={isInvalid}
                        required
                      />
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              {action.error && (
                <p
                  role="alert"
                  className="text-center text-sm text-destructive"
                >
                  {action.error}
                </p>
              )}
              <Field>
                <Button type="submit" className="w-full">
                  {action.pending
                    ? t("common:submitting")
                    : t("auth:sendResetLink")}
                </Button>
              </Field>
              <Button
                nativeButton={false}
                variant="link"
                render={<Link to="/login" />}
              >
                {t("auth:backToSignIn")}
              </Button>
            </FieldGroup>
          </fieldset>
        </form>
      )}
    </AuthPageShell>
  )
}

function resetPasswordSchema(t: TFunction<["auth", "validation"]>) {
  return z
    .object({
      password: z
        .string()
        .min(8, t("validation:passwordMin"))
        .max(128, t("validation:passwordMax")),
      confirmPassword: z.string(),
    })
    .refine((value) => value.password === value.confirmPassword, {
      path: ["confirmPassword"],
      message: t("validation:passwordMismatch"),
    })
}

export function ResetPasswordPage({
  title,
  token,
}: {
  title: string
  token?: string
}) {
  const { t } = useTranslation(["auth", "common", "validation"])
  const client = useWorkspaceAuthClient()
  const action = useAuthAction()
  const [done, setDone] = useState(false)
  const form = useForm({
    defaultValues: { password: "", confirmPassword: "" },
    validators: { onSubmit: resetPasswordSchema(t) },
    onSubmit: async ({ value }) => {
      if (!token) return
      const ok = await action.run(() =>
        client.resetPassword({ newPassword: value.password, token })
      )
      if (ok) setDone(true)
    },
  })
  return (
    <AuthPageShell title={title}>
      {done ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-bold">{t("auth:resetPasswordTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("auth:resetPasswordSuccess")}
          </p>
          <Button nativeButton={false} render={<Link to="/login" />}>
            {t("auth:goToSignIn")}
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
          className="flex flex-col gap-6"
          aria-busy={action.pending}
        >
          <fieldset disabled={action.pending || !token} className="contents">
            <FieldGroup>
              <div className="flex flex-col items-center gap-1 text-center">
                <h1 className="text-2xl font-bold">
                  {t("auth:resetPasswordTitle")}
                </h1>
                <p className="text-sm text-balance text-muted-foreground">
                  {t("auth:resetPasswordDescription")}
                </p>
              </div>
              {!token && (
                <p
                  role="alert"
                  className="text-center text-sm text-destructive"
                >
                  {t("auth:resetLinkInvalid")}
                </p>
              )}
              <form.Field name="password">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor="reset-password">
                        {t("auth:newPassword")}
                      </FieldLabel>
                      <Input
                        id="reset-password"
                        name={field.name}
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        type="password"
                        autoComplete="new-password"
                        minLength={8}
                        maxLength={128}
                        aria-invalid={isInvalid}
                        required
                      />
                      <FieldDescription>
                        {t("auth:passwordHint")}
                      </FieldDescription>
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="confirmPassword">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor="reset-confirm">
                        {t("auth:confirmPassword")}
                      </FieldLabel>
                      <Input
                        id="reset-confirm"
                        name={field.name}
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        type="password"
                        autoComplete="new-password"
                        minLength={8}
                        maxLength={128}
                        aria-invalid={isInvalid}
                        required
                      />
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              {action.error && (
                <p
                  role="alert"
                  className="text-center text-sm text-destructive"
                >
                  {action.error}
                </p>
              )}
              <Field>
                <Button type="submit" className="w-full" disabled={!token}>
                  {action.pending
                    ? t("common:submitting")
                    : t("auth:resetPasswordSubmit")}
                </Button>
              </Field>
            </FieldGroup>
          </fieldset>
        </form>
      )}
    </AuthPageShell>
  )
}

export function EmailVerifiedPage({
  title,
  error,
}: {
  title: string
  error?: string
}) {
  const { t } = useTranslation("auth")
  const failed = typeof error === "string" && error.length > 0
  return (
    <AuthPageShell title={title}>
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">
          {failed ? t("emailVerifyFailed") : t("emailVerifiedTitle")}
        </h1>
        {!failed && (
          <p className="text-sm text-muted-foreground">
            {t("emailVerifiedDescription")}
          </p>
        )}
        <Button nativeButton={false} render={<Link to="/login" />}>
          {t("goToSignIn")}
        </Button>
      </div>
    </AuthPageShell>
  )
}

export function AcceptInvitationPage({
  title,
  invitationId,
  onAccepted,
}: {
  title: string
  invitationId: string
  onAccepted: () => void
}) {
  const { t } = useTranslation(["auth", "common"])
  const client = useWorkspaceAuthClient()
  const session = useAuthenticatedSession()
  const action = useAuthAction()
  const userId = session?.user.id
  // getInvitation 要求已登录且邮箱与受邀人一致；匿名阶段只提示登录，不请求。
  const invitation = useQuery({
    queryKey: ["invitations", invitationId] as const,
    queryFn: async ({ signal }) => {
      const result = await client.organization.getInvitation({
        query: { id: invitationId },
        fetchOptions: { signal },
      })
      if (result.error || !result.data?.organizationName) {
        throw new Error("invalid")
      }
      return result.data.organizationName
    },
    enabled: Boolean(userId),
    retry: false,
  })
  const organizationName = invitation.data
  const invalid = invitation.isError

  return (
    <AuthPageShell title={title}>
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">
          {t("auth:acceptInvitationTitle")}
        </h1>
        {invalid ? (
          <p role="alert">{t("auth:invitationInvalid")}</p>
        ) : organizationName ? (
          <p className="text-sm text-muted-foreground">
            {t("auth:acceptInvitationDescription", {
              organization: organizationName,
            })}
          </p>
        ) : userId ? (
          <p role="status">{t("common:loading")}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("auth:signInToAcceptInvitation")}
          </p>
        )}
        {action.error && (
          <p role="alert" className="text-sm text-destructive">
            {action.error}
          </p>
        )}
        {!session && !invalid && (
          <Button
            nativeButton={false}
            render={
              <Link
                to="/login"
                search={{ redirect: `/accept-invitation/${invitationId}` }}
              />
            }
          >
            {t("auth:signIn")}
          </Button>
        )}
        {session && !invalid && organizationName && (
          <Button
            disabled={action.pending}
            onClick={() => {
              void action.run(async () => {
                const result = await client.organization.acceptInvitation({
                  invitationId,
                })
                if (!result.error) onAccepted()
                return result
              })
            }}
          >
            {action.pending
              ? t("common:submitting")
              : t("auth:acceptInvitation")}
          </Button>
        )}
      </div>
    </AuthPageShell>
  )
}
