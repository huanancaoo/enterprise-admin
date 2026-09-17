import { useTranslation } from "react-i18next"
import { Outlet } from "@tanstack/react-router"
import { AuthSession } from "@workspace/admin/auth"
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
