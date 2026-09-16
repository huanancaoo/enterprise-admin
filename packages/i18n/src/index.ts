import "./generated/i18next.js"
import { createInstance } from "i18next"
import { resources } from "./resources.js"

export const supportedLocales = ["zh-CN", "en-US", "ar"] as const
export type SupportedLocale = (typeof supportedLocales)[number]
export const platformDefaultLocale: SupportedLocale = "zh-CN"

function supported(
  value: string | null | undefined
): SupportedLocale | undefined {
  return supportedLocales.find(
    (locale) => locale.toLowerCase() === value?.toLowerCase()
  )
}

export function resolveLocale(input: {
  acceptLanguage?: string | null
  preferredLocale?: string | null
  defaultLocale?: string | null
}): SupportedLocale {
  // 只有明确支持的语言参与 Header 选择；通配符不覆盖用户或组织偏好。
  const preferences = (input.acceptLanguage ?? "")
    .split(",")
    .flatMap((entry, index) => {
      const match =
        /^\s*([a-zA-Z]+(?:-[a-zA-Z0-9]+)*|\*)\s*(?:;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/.exec(
          entry
        )
      if (!match) return []
      const locale = supported(match[1])
      const weight = match[2] === undefined ? 1 : Number(match[2])
      return locale && weight > 0 ? [{ locale, weight, index }] : []
    })
  preferences.sort((a, b) => b.weight - a.weight || a.index - b.index)
  return (
    preferences[0]?.locale ??
    supported(input.preferredLocale) ??
    supported(input.defaultLocale) ??
    platformDefaultLocale
  )
}

const instance = createInstance()
// 服务端只取固定 translator；浏览器实例独立创建，不改变并发请求的语言。
void instance.init({
  initAsync: false,
  lng: platformDefaultLocale,
  fallbackLng: false,
  resources,
  defaultNS: "errors",
  interpolation: { escapeValue: false },
})
export function getTranslator(locale: SupportedLocale) {
  return instance.getFixedT(locale, "errors")
}
export { resources } from "./resources.js"
export { createUiI18n, localeMeta, syncDocumentLanguage } from "./config.js"
export { createFormatter } from "./format.js"

export type { TFunction } from "i18next"
