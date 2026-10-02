import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import {
  localeSettingsUser,
  organizations,
  type LocaleSettingsTarget,
} from "@workspace/mocks"
import { authClient } from "../lib/auth-client"
import {
  OrganizationLocaleSettingsRoute,
  PersonalLocaleSettingsRoute,
} from "./locale-settings"

export function LocaleSettingsStory({
  target,
  narrow = false,
}: {
  target: LocaleSettingsTarget
  narrow?: boolean
}) {
  // 只运行设置 Feature；全应用组织切换与身份守卫仍由真实浏览器链路验收。
  return (
    <AuthenticatedSessionProvider client={authClient} user={localeSettingsUser}>
      <main className="p-6" style={narrow ? { width: 320 } : undefined}>
        {target === "personal" ? (
          <PersonalLocaleSettingsRoute />
        ) : (
          <OrganizationLocaleSettingsRoute
            organizationId={organizations[0].id}
          />
        )}
      </main>
    </AuthenticatedSessionProvider>
  )
}
