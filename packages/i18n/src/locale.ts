export const supportedLocales = ["zh-CN", "en-US", "ar"] as const
export type SupportedLocale = (typeof supportedLocales)[number]
export const platformDefaultLocale: SupportedLocale = "zh-CN"

// 邮件正文只有这两种；ar 是否进入邮件是产品决定，不在协商算法里分叉。
export const emailLocales = ["zh-CN", "en-US"] as const
export type EmailLocale = (typeof emailLocales)[number]
export const localeSources = [
  "request",
  "user",
  "organization",
  "platform",
] as const
export type LocaleSource = (typeof localeSources)[number]

export type LocaleResolution = {
  locale: SupportedLocale
  source: LocaleSource
}
export type InheritedLocaleResolution = {
  locale: SupportedLocale
  source: Exclude<LocaleSource, "request">
}

export function matchSupportedLocale(
  value: string | null | undefined,
  allowed: readonly SupportedLocale[] = supportedLocales
): SupportedLocale | undefined {
  if (!value) return undefined
  return allowed.find((locale) => locale.toLowerCase() === value.toLowerCase())
}

export function resolveLocaleWithSource(input: {
  acceptLanguage?: string | null
  preferredLocale?: string | null
  defaultLocale?: string | null
  allowed?: readonly SupportedLocale[]
}): LocaleResolution {
  const allowed = input.allowed ?? supportedLocales
  // 只有明确支持的语言参与 Header 选择；通配符不覆盖用户或组织偏好。
  const preferences = (input.acceptLanguage ?? "")
    .split(",")
    .flatMap((entry, index) => {
      const match =
        /^\s*([a-zA-Z]+(?:-[a-zA-Z0-9]+)*|\*)\s*(?:;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/.exec(
          entry
        )
      if (!match) return []
      const locale = matchSupportedLocale(match[1], allowed)
      const weight = match[2] === undefined ? 1 : Number(match[2])
      return locale && weight > 0 ? [{ locale, weight, index }] : []
    })
  preferences.sort((a, b) => b.weight - a.weight || a.index - b.index)
  if (preferences[0])
    return { locale: preferences[0].locale, source: "request" }
  const preferred = matchSupportedLocale(input.preferredLocale, allowed)
  if (preferred) return { locale: preferred, source: "user" }
  const organization = matchSupportedLocale(input.defaultLocale, allowed)
  if (organization) return { locale: organization, source: "organization" }
  return { locale: platformDefaultLocale, source: "platform" }
}

export function resolveLocale(input: {
  acceptLanguage?: string | null
  preferredLocale?: string | null
  defaultLocale?: string | null
  allowed?: readonly SupportedLocale[]
}): SupportedLocale {
  return resolveLocaleWithSource(input).locale
}

export function resolveInheritedLocale(input: {
  preferredLocale?: string | null
  defaultLocale?: string | null
  allowed?: readonly SupportedLocale[]
}): InheritedLocaleResolution {
  const resolution = resolveLocaleWithSource(input)
  return {
    locale: resolution.locale,
    source: resolution.source as InheritedLocaleResolution["source"],
  }
}

export function resolveEmailLocale(
  requested: string | null | undefined,
  fallback: EmailLocale
): EmailLocale {
  const locale = resolveLocale({
    preferredLocale: requested,
    defaultLocale: fallback,
    allowed: emailLocales,
  })
  // allowed 与 platformDefaultLocale 都落在 emailLocales 内；否则用调用方给出的邮件默认语言。
  return locale === "zh-CN" || locale === "en-US" ? locale : fallback
}
