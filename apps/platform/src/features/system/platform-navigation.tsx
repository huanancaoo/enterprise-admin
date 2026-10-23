import { AdminPage, PermissionDeniedState } from "@workspace/admin"
import { useTranslation } from "react-i18next"

export function PlatformHomePage() {
  const { t } = useTranslation("auth")
  return (
    <AdminPage title={t("platformTitle")}>
      <PermissionDeniedState />
    </AdminPage>
  )
}
