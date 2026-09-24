import { bindRequestLocale } from "@workspace/api-client"
import { matchSupportedLocale, platformDefaultLocale } from "@workspace/i18n"

export function bindWorkspaceRequestLocale(instance: { language: string }) {
  // 读 i18next 当前语言，不读 documentElement.lang：后者要等 effect，请求可能更早发出。
  bindRequestLocale(
    () => matchSupportedLocale(instance.language) ?? platformDefaultLocale
  )
}
