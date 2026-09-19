import { useTranslation } from "react-i18next"
import {
  Link,
  Outlet,
  useRouteContext,
  useSearch,
} from "@tanstack/react-router"
import { AppShell } from "@workspace/admin"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@workspace/ui/components/breadcrumb"
import {
  AuthenticatedSessionProvider,
  CredentialsPage,
  EmailVerifiedPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  useAuthenticatedSession,
} from "@workspace/admin/auth"
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
  return <CredentialsPage title={t("platformTitle")} />
}

export function PlatformLayout() {
  const { t } = useTranslation(["auth", "common"])
  const session = useAuthenticatedSession()!
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
              description: t("auth:signedIn"),
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
