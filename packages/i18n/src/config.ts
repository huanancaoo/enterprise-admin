import { createInstance, type i18n } from "i18next"
import { resources } from "./resources.js"
import {
  matchSupportedLocale,
  platformDefaultLocale,
  type SupportedLocale,
} from "./locale.js"

export const localeMeta = {
  "zh-CN": { label: "简体中文", direction: "ltr" },
  "en-US": { label: "English", direction: "ltr" },
  ar: { label: "العربية", direction: "rtl" },
} as const

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

export function syncDocumentLanguage(instance: i18n, document: Document) {
  const sync = () => {
    const locale =
      matchSupportedLocale(instance.language) ?? platformDefaultLocale
    document.documentElement.lang = locale
    document.documentElement.dir = localeMeta[locale].direction
  }
  sync()
  instance.on("languageChanged", sync)
  return () => {
    instance.off("languageChanged", sync)
  }
}
