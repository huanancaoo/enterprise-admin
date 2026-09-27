import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Link,
  Outlet,
  useNavigate,
  useRouteContext,
  useSearch,
} from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"
import { AppShell } from "@workspace/admin"
import {
  AuthenticatedSessionProvider,
  CredentialsPage,
  EmailVerifiedPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  useAuthenticatedSession,
} from "@workspace/admin/auth"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@workspace/ui/components/breadcrumb"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { LayoutDashboardIcon } from "lucide-react"
import { authClient } from "./lib/auth-client"

export function App() {
  const { user } = useRouteContext({ from: "__root__" })
  const outlet = <Outlet />
  if (!user) return outlet
  return (
    <AuthenticatedSessionProvider client={authClient} user={user}>
      <section key={user.id}>{outlet}</section>
    </AuthenticatedSessionProvider>
  )
}

export function PlatformLoginPage() {
  const { t } = useTranslation("auth")
  const navigate = useNavigate()
  return (
    <CredentialsPage
      title={t("platformTitle")}
      onMfaRequired={() =>
        void navigate({ to: "/platform/mfa", search: { challenge: true } })
      }
    />
  )
}

export function PlatformLayout() {
  const { t } = useTranslation(["auth", "common"])
  const session = useAuthenticatedSession()!
  const { platformAccess } = useRouteContext({ from: "/platform" })
  return (
    <AppShell
      breadcrumb={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>{t("auth:platformTitle")}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
      sidebar={{
        teamSwitcher: {
          teams: [
            {
              id: "platform",
              name: t("auth:platformTitle"),
              description: `${t(platformAccess.role === "platform_admin" ? "auth:platformAdminRole" : "auth:platformAuditorRole")} · ${t("auth:globalScope")}`,
            },
          ],
          value: "platform",
          label: t("auth:platformTitle"),
          disabled: true,
          onSelect: () => undefined,
        },
        navigation: {
          label: t("common:navigation"),
          items: [
            {
              title: t("auth:platformTitle"),
              icon: <LayoutDashboardIcon />,
              isActive: true,
              render: <Link to="/platform" />,
            },
          ],
        },
        user: {
          user: {
            name: session.user.name,
            email: session.user.email,
            avatar: session.user.image ?? undefined,
            lastLoginMethod: session.user.lastLoginMethod,
          },
          signingOut: session.signingOut,
          error: session.signOutError,
          onSignOut: session.signOut,
        },
      }}
    >
      <Outlet />
    </AppShell>
  )
}

export function PlatformMfaPage() {
  const { t } = useTranslation(["auth", "common", "validation"])
  const root = useRouteContext({ from: "__root__" })
  const { challenge } = useSearch({ from: "/platform/mfa" })
  const user = root.user
  const twoFactorEnabled = Boolean(
    user && "twoFactorEnabled" in user && user.twoFactorEnabled
  )
  const setupRequired = Boolean(user && !twoFactorEnabled && !challenge)
  const [totpUri, setTotpUri] = useState<string>()
  const [error, setError] = useState(false)
  const verificationRequired = !setupRequired || Boolean(totpUri)
  const validationSchema = z
    .object({ password: z.string(), code: z.string() })
    .superRefine(({ password, code }, context) => {
      if (verificationRequired && !/^\d{6}$/.test(code)) {
        context.addIssue({
          code: "custom",
          path: ["code"],
          message: t("auth:mfaCodeInvalid"),
        })
      }
      if (!verificationRequired && password.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["password"],
          message: t("validation:passwordRequired"),
        })
      }
    })
  const form = useForm({
    defaultValues: { password: "", code: "" },
    validators: { onSubmit: validationSchema },
    onSubmit: async ({ value }) => {
      setError(false)
      if (!verificationRequired) {
        const result = await authClient.twoFactor.enable({
          password: value.password,
          method: "totp",
          issuer: "Enterprise Admin",
        })
        if (result.error) {
          setError(true)
          return
        }
        if (!("totpURI" in result.data)) {
          setError(true)
          return
        }
        setTotpUri(result.data.totpURI)
        return
      }
      const result = await authClient.twoFactor.verifyTotp({
        code: value.code,
        trustDevice: false,
      })
      if (result.error) {
        setError(true)
        return
      }
      window.location.assign("/platform")
    },
  })

  return (
    <main className="mx-auto flex min-h-svh max-w-lg items-center px-6 py-10">
      <form
        className="w-full space-y-6 rounded-xl border bg-card p-6 shadow-sm"
        aria-busy={form.state.isSubmitting}
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <FieldGroup>
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold">
              {setupRequired && !totpUri
                ? t("auth:mfaSetupTitle")
                : t("auth:mfaVerifyTitle")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {setupRequired && !totpUri
                ? t("auth:mfaSetupDescription")
                : t("auth:mfaVerifyDescription")}
            </p>
          </div>
          {totpUri && (
            <Field>
              <FieldLabel htmlFor="platform-totp-uri">
                {t("auth:mfaAuthenticatorUri")}
              </FieldLabel>
              <Input
                id="platform-totp-uri"
                readOnly
                value={totpUri}
                autoComplete="off"
                onFocus={(event) => event.currentTarget.select()}
              />
              <FieldDescription>
                {t("auth:mfaAuthenticatorHint")}
              </FieldDescription>
            </Field>
          )}
          {verificationRequired ? (
            <form.Field name="code">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="platform-totp-code">
                      {t("auth:mfaCode")}
                    </FieldLabel>
                    <Input
                      id="platform-totp-code"
                      name={field.name}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                      aria-invalid={invalid}
                      required
                    />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
          ) : (
            <form.Field name="password">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="platform-mfa-password">
                      {t("auth:password")}
                    </FieldLabel>
                    <Input
                      id="platform-mfa-password"
                      name={field.name}
                      type="password"
                      autoComplete="current-password"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                      aria-invalid={invalid}
                      required
                    />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t("auth:mfaFailed")}
            </p>
          )}
          <Button
            className="w-full"
            type="submit"
            disabled={form.state.isSubmitting}
          >
            {form.state.isSubmitting
              ? t("common:submitting")
              : verificationRequired
                ? t("auth:mfaVerifyButton")
                : t("auth:mfaSetupButton")}
          </Button>
        </FieldGroup>
      </form>
    </main>
  )
}

export function PlatformAccessDeniedPage() {
  const { t } = useTranslation("auth")
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold">
        {t("platformAccessDeniedTitle")}
      </h1>
      <p className="text-muted-foreground">
        {t("platformAccessDeniedDescription")}
      </p>
      <Link className="underline underline-offset-4" to="/login">
        {t("signIn")}
      </Link>
    </main>
  )
}

export function PlatformHome() {
  const { t } = useTranslation("auth")
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">{t("signedIn")}</h1>
      <p className="text-muted-foreground">{t("platformUnavailable")}</p>
    </div>
  )
}

export function PlatformAuthTitlePage({
  Page,
}: {
  Page: typeof ForgotPasswordPage
}) {
  const { t } = useTranslation("auth")
  return <Page title={t("platformTitle")} />
}

export function PlatformResetPasswordPage() {
  const { t } = useTranslation("auth")
  const { token } = useSearch({ from: "/reset-password" })
  return <ResetPasswordPage title={t("platformTitle")} token={token} />
}

export function PlatformEmailVerifiedPage() {
  const { t } = useTranslation("auth")
  const { error } = useSearch({ from: "/auth/verified" })
  return <EmailVerifiedPage title={t("platformTitle")} error={error} />
}
