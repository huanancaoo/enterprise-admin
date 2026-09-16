import { useTranslation } from "react-i18next"
import { AuthSession } from "@workspace/admin/auth"
import { authClient } from "./lib/auth-client"

export function App() {
  const { t } = useTranslation(["organization", "auth"])
  return (
    <AuthSession
      client={authClient}
      title={t("auth:platformTitle")}
      authenticatedPath="/platform/"
    >
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">{t("auth:signedIn")}</h1>
        <p className="text-muted-foreground">{t("auth:platformUnavailable")}</p>
      </div>
    </AuthSession>
  )
}
