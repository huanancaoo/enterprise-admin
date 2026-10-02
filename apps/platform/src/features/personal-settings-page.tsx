import { useTranslation } from "react-i18next"
import { PersonalAvatarSettings } from "@workspace/admin"
import { authClient } from "../lib/auth-client"

export function PlatformPersonalSettingsPage() {
  const { t } = useTranslation("settings")
  return (
    <section className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("personalSettings")}</h1>
      <PersonalAvatarSettings client={authClient} />
    </section>
  )
}
