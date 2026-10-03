import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { getMyPreferencesOptions } from "@workspace/api-client"
import { useTranslation } from "react-i18next"
import {
  Link,
  Outlet,
  useNavigate,
  useRouteContext,
  useSearch,
  useLocation,
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
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
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
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  ArrowUpRightIcon,
  BuildingIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react"
import { authClient } from "./lib/auth-client"

export function App() {
  // 同账号资料变化不会重跑 root route；头像必须跟随原生 Session 的当前 User 投影。
  const { data } = authClient.useSession()
  const user = data?.user
  const outlet = <Outlet />
  if (!user) return outlet
  return (
    <AuthenticatedSessionProvider client={authClient} user={user}>
      <section key={user.id}>
        <PlatformLocale />
        {outlet}
      </section>
    </AuthenticatedSessionProvider>
  )
}

function PlatformLocale() {
  const { i18n } = useTranslation()
  const session = useAuthenticatedSession()!
  const preferences = useQuery(getMyPreferencesOptions(session.user.id))
  const initializedUser = useRef<string | null>(null)
  useEffect(() => {
    if (
      !preferences.isSuccess ||
      preferences.isFetching ||
      initializedUser.current === session.user.id
    )
      return
    initializedUser.current = session.user.id
    // 账号上下文初始化使用持久化偏好；后续手动切换显示语言仍由当前 UI 持有。
    void i18n.changeLanguage(preferences.data.data.effectiveLocale)
  }, [
    i18n,
    preferences.data,
    preferences.isFetching,
    preferences.isSuccess,
    session.user.id,
  ])
  return null
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
  const navigate = useNavigate()
  const { t } = useTranslation(["auth", "common", "organization", "settings"])
  const location = useLocation()
  const session = useAuthenticatedSession()!
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const section = location.pathname.startsWith("/platform/organizations")
    ? { title: t("organization:platformOrganizations"), kind: "organizations" }
    : location.pathname.startsWith("/platform/users")
      ? { title: t("organization:platformUsers"), kind: "users" }
      : location.pathname.startsWith("/platform/audit-events")
        ? { title: t("organization:audit"), kind: "audit" }
        : location.pathname.startsWith("/platform/settings")
          ? { title: t("organization:platformSettings"), kind: "settings" }
          : location.pathname.startsWith("/platform/personal-settings")
            ? { title: t("settings:personalSettings"), kind: "personal" }
            : null
  const detailId =
    section && ["organizations", "users"].includes(section.kind)
      ? location.pathname.split("/")[3]
      : undefined
  return (
    <AppShell
      breadcrumb={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              {section ? (
                <BreadcrumbLink render={<Link to="/platform" />}>
                  {t("auth:platformTitle")}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{t("auth:platformTitle")}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            {section && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {detailId && section.kind === "organizations" ? (
                    <BreadcrumbLink
                      render={
                        <Link
                          to="/platform/organizations"
                          search={{
                            page: 1,
                            pageSize: 20,
                            sortBy: "createdAt",
                            sortOrder: "desc",
                          }}
                        />
                      }
                    >
                      {section.title}
                    </BreadcrumbLink>
                  ) : detailId && section.kind === "users" ? (
                    <BreadcrumbLink
                      render={
                        <Link
                          to="/platform/users"
                          search={{ page: 1, pageSize: 20 }}
                        />
                      }
                    >
                      {section.title}
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{section.title}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {detailId && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem className="min-w-0">
                      <BreadcrumbPage
                        className="max-w-32 truncate sm:max-w-64"
                        title={detailId}
                      >
                        <bdi>{detailId}</bdi>
                      </BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </>
            )}
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
              title: t("settings:personalSettings"),
              icon: <UserRoundIcon />,
              isActive: location.pathname === "/platform/personal-settings",
              render: <Link to="/platform/personal-settings" />,
            },
            {
              title: t("organization:platformSettings"),
              icon: <SettingsIcon />,
              isActive: location.pathname.startsWith("/platform/settings"),
              render: <Link to="/platform/settings" />,
            },
            {
              title: t("organization:audit"),
              icon: <ClipboardListIcon />,
              isActive: location.pathname.startsWith("/platform/audit-events"),
              render: <Link to="/platform/audit-events" search={{}} />,
            },
            {
              title: t("organization:platformUsers"),
              icon: <UsersIcon />,
              isActive: location.pathname.startsWith("/platform/users"),
              render: (
                <Link to="/platform/users" search={{ page: 1, pageSize: 20 }} />
              ),
            },
            {
              title: t("auth:platformTitle"),
              icon: <LayoutDashboardIcon />,
              isActive: location.pathname === "/platform",
              render: <Link to="/platform" />,
            },
            {
              title: t("organization:platformOrganizations"),
              icon: <BuildingIcon />,
              isActive: location.pathname.startsWith("/platform/organizations"),
              render: (
                <Link
                  to="/platform/organizations"
                  search={{
                    page: 1,
                    pageSize: 20,
                    sortBy: "createdAt",
                    sortOrder: "desc",
                  }}
                />
              ),
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
          onPersonalSettings: () =>
            void navigate({ to: "/platform/personal-settings" }),
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
        className="w-full space-y-6 rounded-2xl bg-card p-6 ring-1 ring-foreground/10 sm:p-8"
        aria-busy={form.state.isSubmitting}
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <FieldGroup>
          <div className="space-y-2 text-center">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
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
                className="font-mono text-xs"
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
                      className="text-center font-mono text-lg tracking-[0.35em]"
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
            <p
              role="alert"
              className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
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
  const session = useAuthenticatedSession()
  const navigate = useNavigate()

  async function signOutAndUseAnotherAccount() {
    if (!session) return
    if (await session.signOut()) await navigate({ to: "/login" })
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col items-center justify-center gap-5 px-6 py-10 text-center">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        {t("platformAccessDeniedTitle")}
      </h1>
      <p className="text-muted-foreground">
        {t("platformAccessDeniedDescription")}
      </p>
      {session ? (
        <>
          <Button
            disabled={session.signingOut}
            onClick={() => void signOutAndUseAnotherAccount()}
          >
            {session.signingOut
              ? t("signingOut")
              : t("signOutAndUseAnotherAccount")}
          </Button>
          {session.signOutError && (
            <p
              role="alert"
              className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              {session.signOutError}
            </p>
          )}
        </>
      ) : (
        <Link className="underline underline-offset-4" to="/login">
          {t("signIn")}
        </Link>
      )}
    </main>
  )
}

export function PlatformHome() {
  const { t } = useTranslation(["auth", "organization", "settings"])
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const shortcutClass =
    "group rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
  const contentClass =
    "flex min-h-28 items-center gap-4 transition-colors group-hover:bg-muted/40"
  return (
    <section className="min-w-0 space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("auth:platformTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("auth:signedIn")}</p>
        </div>
        <Badge
          variant="secondary"
          className="max-w-full flex-wrap justify-start gap-2 py-1.5 whitespace-normal"
        >
          <ShieldCheckIcon className="size-3.5 shrink-0" />
          {t(
            platformAccess.role === "platform_admin"
              ? "auth:platformAdminRole"
              : "auth:platformAuditorRole"
          )}
          <span className="border-s border-foreground/15 ps-2 text-muted-foreground">
            {t("auth:globalScope")}
          </span>
        </Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Link
          className={shortcutClass}
          to="/platform/organizations"
          search={{
            page: 1,
            pageSize: 20,
            sortBy: "createdAt",
            sortOrder: "desc",
          }}
        >
          <Card className={contentClass}>
            <CardContent className="flex w-full items-center gap-4">
              <BuildingIcon className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-base font-medium">
                {t("organization:platformOrganizations")}
              </span>
              <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link
          className={shortcutClass}
          to="/platform/users"
          search={{ page: 1, pageSize: 20 }}
        >
          <Card className={contentClass}>
            <CardContent className="flex w-full items-center gap-4">
              <UsersIcon className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-base font-medium">
                {t("organization:platformUsers")}
              </span>
              <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link className={shortcutClass} to="/platform/audit-events" search={{}}>
          <Card className={contentClass}>
            <CardContent className="flex w-full items-center gap-4">
              <ClipboardListIcon className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-base font-medium">
                {t("organization:audit")}
              </span>
              <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link className={shortcutClass} to="/platform/settings">
          <Card className={contentClass}>
            <CardContent className="flex w-full items-center gap-4">
              <SettingsIcon className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-base font-medium">
                {t("organization:platformSettings")}
              </span>
              <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link className={shortcutClass} to="/platform/personal-settings">
          <Card className={contentClass}>
            <CardContent className="flex w-full items-center gap-4">
              <UserRoundIcon className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-base font-medium">
                {t("settings:personalSettings")}
              </span>
              <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>
    </section>
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
