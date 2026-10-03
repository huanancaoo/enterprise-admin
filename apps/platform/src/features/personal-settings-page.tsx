import { useTranslation } from "react-i18next"
import { PersonalAvatarSettings } from "@workspace/admin"
import { authClient } from "../lib/auth-client"

export function PlatformPersonalSettingsPage() {
  const { t } = useTranslation("settings")
  return (
    <section className="max-w-3xl min-w-0 space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
        {t("personalSettings")}
      </h1>
      <PersonalAvatarSettings client={authClient} />
    </section>
  )
}
