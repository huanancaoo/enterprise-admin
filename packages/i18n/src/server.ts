import "./generated/i18next.js"
import { createInstance } from "i18next"
import errorsZh from "./locales/zh-CN/errors.json" with { type: "json" }
import errorsEn from "./locales/en-US/errors.json" with { type: "json" }
import errorsAr from "./locales/ar/errors.json" with { type: "json" }
import { platformDefaultLocale, type SupportedLocale } from "./locale.js"

const instance = createInstance()
// 服务端只翻译错误码；固定语言 translator 不改变并发请求共享的语言状态。
void instance.init({
  initAsync: false,
  lng: platformDefaultLocale,
  fallbackLng: false,
  resources: {
    "zh-CN": { errors: errorsZh },
    "en-US": { errors: errorsEn },
    ar: { errors: errorsAr },
  },
  defaultNS: "errors",
  interpolation: { escapeValue: false },
})

export function getTranslator(locale: SupportedLocale) {
  return instance.getFixedT(locale, "errors")
}
