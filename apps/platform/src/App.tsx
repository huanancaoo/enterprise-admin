import { useEffect, useRef } from "react"
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
import { AppShell } from "@workspace/admin"
import {
  AuthenticatedSessionProvider,
  CredentialsPage,
  EmailVerifiedPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  useAuthenticatedSession,
  DeviceSessionMenu,
  DeviceSessionActions,
  TotpChallengePage,
  DeviceAccountSwitcher,
  useAuthAction,
} from "@workspace/admin/auth"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import { Button } from "@workspace/ui/components/button"
import {
  BuildingIcon,
  ClipboardListIcon,
  SettingsIcon,
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
  const addingAccount = useLocation().pathname === "/add-account"
  return (
    <CredentialsPage
      title={t("platformTitle")}
      addingAccount={addingAccount}
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
        ? { title: t("organization:platformOperationsLog"), kind: "audit" }
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
            {
              title: t("organization:platformUsers"),
              icon: <UsersIcon />,
              isActive: location.pathname.startsWith("/platform/users"),
              render: (
                <Link to="/platform/users" search={{ page: 1, pageSize: 20 }} />
              ),
            },
            {
              title: t("organization:platformOperationsLog"),
              icon: <ClipboardListIcon />,
              isActive: location.pathname.startsWith("/platform/audit-events"),
              render: (
                <Link
                  to="/platform/audit-events"
                  search={{ page: 1, pageSize: 20 }}
                />
              ),
            },
            {
              title: t("organization:platformSettings"),
              icon: <SettingsIcon />,
              isActive: location.pathname.startsWith("/platform/settings"),
              render: <Link to="/platform/settings" />,
            },
          ],
        },
        user: {
          user: {
            name: session.user.name,
            email: session.user.email,
            avatar: session.user.image ?? undefined,
          },
          accountMenu: (action) => (
            <DeviceSessionMenu
              action={action}
              onAddAccount={() => void navigate({ to: "/add-account" })}
            />
          ),
          signOutMenu: (action) => <DeviceSessionActions action={action} />,
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
  const { t } = useTranslation("auth")
  return <TotpChallengePage title={t("platformTitle")} />
}

export function PlatformAccessDeniedPage() {
  const { t } = useTranslation("auth")
  const session = useAuthenticatedSession()
  const navigate = useNavigate()
  const accountAction = useAuthAction()

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
      <DeviceAccountSwitcher
        action={accountAction}
        disabled={session?.signingOut}
        onAddAccount={() => void navigate({ to: "/add-account" })}
      />
      {session ? (
        <>
          <Button
            disabled={session.signingOut || accountAction.pending}
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
