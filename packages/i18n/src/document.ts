import type { i18n } from "i18next"
import {
  localeMeta,
  matchSupportedLocale,
  platformDefaultLocale,
} from "./locale.js"

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
