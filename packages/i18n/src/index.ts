import "./generated/i18next.js"
import { createInstance } from "i18next"
import { resources } from "./resources.js"
import { platformDefaultLocale, type SupportedLocale } from "./locale.js"

export {
  emailLocales,
  matchSupportedLocale,
  platformDefaultLocale,
  resolveEmailLocale,
  resolveLocale,
  supportedLocales,
} from "./locale.js"
export type { EmailLocale, SupportedLocale } from "./locale.js"
export { authErrorTranslations } from "./catalog.js"
export { emailCatalog } from "./email-catalog.js"
export type { EmailCopy, EmailTemplateKey } from "./email-catalog.js"

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
