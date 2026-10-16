import "./generated/i18next.js"

export {
  emailLocales,
  matchSupportedLocale,
  platformDefaultLocale,
  resolveEmailLocale,
  resolveInheritedLocale,
  resolveLocale,
  resolveLocaleWithSource,
  localeSources,
  localeMeta,
  supportedLocales,
} from "./locale.js"
export type {
  EmailLocale,
  InheritedLocaleResolution,
  LocaleResolution,
  LocaleSource,
  SupportedLocale,
} from "./locale.js"
export { createFormatter } from "./format.js"
export type { TFunction } from "i18next"
