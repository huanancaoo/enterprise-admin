import { useTranslation } from "react-i18next"
import { AuthSession } from "@workspace/admin/auth"
import { authClient } from "@/lib/auth-client"
import { OrganizationWorkspace } from "@/components/organization-workspace"

export function App() {
  const { t } = useTranslation(["organization", "auth"])
  return (
    <AuthSession
      client={authClient}
      title={t("organization:management")}
      authenticatedPath="/app/select-organization"
      allowSignUp
    >
      <OrganizationWorkspace />
    </AuthSession>
  )
}
