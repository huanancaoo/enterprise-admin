import { createInstance, type i18n } from "i18next"
import { resources } from "./resources.js"
import { localeMeta, type SupportedLocale } from "./locale.js"

export function createUiI18n(locale: SupportedLocale = "zh-CN"): i18n {
  const instance = createInstance()
  void instance.init({
    initAsync: false,
    lng: locale,
    supportedLngs: Object.keys(localeMeta),
    load: "currentOnly",
    fallbackLng: false,
    resources,
    defaultNS: "common",
    interpolation: { escapeValue: false },
  })
  return instance
}
