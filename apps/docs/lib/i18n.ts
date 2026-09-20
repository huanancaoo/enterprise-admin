import { defineI18n } from "fumadocs-core/i18n"

export const i18n = defineI18n({
  defaultLanguage: "en-US",
  languages: ["en-US", "zh-CN"],
  hideLocale: "never",
  fallbackLanguage: "en-US",
})

export type Locale = (typeof i18n.languages)[number]

export function isLocale(lang: string): lang is Locale {
  return (i18n.languages as readonly string[]).includes(lang)
}
