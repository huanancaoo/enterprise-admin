import { useTranslation } from "react-i18next"
import { Outlet, useParams, useSearch } from "@tanstack/react-router"
import {
  AcceptInvitationPage,
  AuthSession,
  EmailVerifiedPage,
  ForgotPasswordPage,
  ResetPasswordPage,
} from "@workspace/admin/auth"
import { authClient } from "@/lib/auth-client"

export function App() {
  const { t } = useTranslation(["organization", "auth"])
  return (
    <AuthSession
      client={authClient}
      title={t("organization:management")}
      authenticatedPath="/app"
      allowSignUp
    >
      <Outlet />
    </AuthSession>
  )
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
  const { invitationId } = useParams({
    from: "/accept-invitation/$invitationId",
  })
  return (
    <AcceptInvitationPage title={t("management")} invitationId={invitationId} />
  )
}
