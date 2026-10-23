import { useTranslation } from "react-i18next"
import {
  PersonalAvatarSettings,
  PersonalSecuritySettings,
  AdminPage,
} from "@workspace/admin"
import { authClient } from "../lib/auth-client"

export function PlatformPersonalSettingsPage() {
  const { t } = useTranslation("settings")
  return (
    <AdminPage title={t("personalSettings")} contentWidth="form">
      <PersonalAvatarSettings client={authClient} />
      <PersonalSecuritySettings client={authClient} />
    </AdminPage>
  )
}
