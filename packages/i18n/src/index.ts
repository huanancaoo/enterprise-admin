import { createInstance } from "i18next"

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

const zh = {
  VALIDATION_ERROR: "请求参数无效",
  UNAUTHENTICATED: "请先登录",
  FORBIDDEN: "无权访问此资源",
  NOT_FOUND: "资源不存在",
  INTERNAL_ERROR: "服务器内部错误",
}
const en: Record<keyof typeof zh, string> = {
  VALIDATION_ERROR: "Invalid request parameters",
  UNAUTHENTICATED: "Authentication required",
  FORBIDDEN: "Access denied",
  NOT_FOUND: "Resource not found",
  INTERNAL_ERROR: "Internal server error",
}
const ar: Record<keyof typeof zh, string> = {
  VALIDATION_ERROR: "معلمات الطلب غير صالحة",
  UNAUTHENTICATED: "يرجى تسجيل الدخول",
  FORBIDDEN: "الوصول غير مسموح",
  NOT_FOUND: "المورد غير موجود",
  INTERNAL_ERROR: "خطأ داخلي في الخادم",
}
const instance = createInstance()
// 静态内置资源同步初始化；请求只取固定 translator，不改变共享实例语言。
void instance.init({
  initAsync: false,
  lng: platformDefaultLocale,
  fallbackLng: false,
  resources: {
    "zh-CN": { errors: zh },
    "en-US": { errors: en },
    ar: { errors: ar },
  },
  defaultNS: "errors",
  interpolation: { escapeValue: false },
})
export function getTranslator(locale: SupportedLocale) {
  return instance.getFixedT(locale, "errors")
}
