import errorsAr from "./locales/ar/errors.json" with { type: "json" }
import errorsEn from "./locales/en-US/errors.json" with { type: "json" }
import errorsZh from "./locales/zh-CN/errors.json" with { type: "json" }
import type { SupportedLocale } from "./locale.js"

// Better Auth 自带文案仍由插件 adapter 合并；这里只是产品错误码。
const authErrorCodes = [
  "AUTHORIZATION_UNAVAILABLE",
  "AUTHORIZATION_VERSION_CONFLICT",
  "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
  "ORGANIZATION_ALREADY_EXISTS",
  "ORGANIZATION_NOT_FOUND",
  "ORGANIZATION_SLUG_ALREADY_TAKEN",
  "ORGANIZATION_SUSPENDED",
  "INVALID_MEMBER_QUERY",
  "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
  "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
  "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
  "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
  "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER",
] as const

function pick(catalog: Record<string, string>): Record<string, string> {
  return Object.fromEntries(authErrorCodes.map((code) => [code, catalog[code]]))
}

export function authErrorTranslations(): Record<
  SupportedLocale,
  Record<string, string>
> {
  return {
    "zh-CN": pick(errorsZh),
    "en-US": pick(errorsEn),
    ar: pick(errorsAr),
  }
}
