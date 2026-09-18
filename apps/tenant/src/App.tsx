import { useTranslation } from "react-i18next"
import {
  Outlet,
  useNavigate,
  useParams,
  useRouteContext,
  useSearch,
} from "@tanstack/react-router"
import {
  AcceptInvitationPage,
  AuthenticatedSessionProvider,
  CredentialsPage,
  EmailVerifiedPage,
  ForgotPasswordPage,
  ResetPasswordPage,
} from "@workspace/admin/auth"
import { authClient } from "@/lib/auth-client"

export function App() {
  const { user } = useRouteContext({ from: "__root__" })
  const outlet = <Outlet />
  if (!user) return outlet
  return (
    <AuthenticatedSessionProvider client={authClient} user={user}>
      {/* 用户变化时卸载组织页面，避免将前一个用户的表单状态带入新会话。 */}
      <section key={user.id}>{outlet}</section>
    </AuthenticatedSessionProvider>
  )
}

export function TenantLoginPage() {
  const { t } = useTranslation("organization")
  return <CredentialsPage title={t("management")} allowSignUp />
}

export function TenantAuthTitlePage({
  Page,
}: {
  Page: typeof ForgotPasswordPage
}) {
  const { t } = useTranslation("organization")
  return <Page title={t("management")} />
}

export function TenantResetPasswordPage() {
  const { t } = useTranslation("organization")
  const { token } = useSearch({ from: "/reset-password" })
  return <ResetPasswordPage title={t("management")} token={token} />
}

export function TenantEmailVerifiedPage() {
  const { t } = useTranslation("organization")
  const { error } = useSearch({ from: "/auth/verified" })
  return <EmailVerifiedPage title={t("management")} error={error} />
}

export function TenantAcceptInvitationPage() {
  const { t } = useTranslation("organization")
  const navigate = useNavigate()
  const { invitationId } = useParams({
    from: "/accept-invitation/$invitationId",
  })
  return (
    <AcceptInvitationPage
      title={t("management")}
      invitationId={invitationId}
      onAccepted={() => void navigate({ to: "/app" })}
    />
  )
}
