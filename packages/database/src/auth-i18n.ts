import { i18n, locales } from "@better-auth/i18n"
import type { BetterAuthPlugin } from "better-auth"
import { authErrorTranslations } from "@workspace/i18n/catalog"
import { resolveLocale } from "@workspace/i18n/locale"

const custom = authErrorTranslations()

export function createAuthI18n(): BetterAuthPlugin {
  return i18n({
    translations: {
      "zh-CN": { ...locales.zh, ...custom["zh-CN"] },
      "en-US": { ...locales.en, ...custom["en-US"] },
      ar: { ...locales.ar, ...custom.ar },
    },
    defaultLocale: "zh-CN",
    // 插件自带 header 策略会把 zh-CN 裁成 zh，无法匹配产品语言标签。
    detection: ["callback"],
    getLocale: (ctx) => {
      const preferred = ctx.context.session?.user?.preferredLocale
      // 此 callback 只有会话用户，没有组织默认语言；组织默认由 RequestLanguage 在租户解析后注入。
      return resolveLocale({
        acceptLanguage: ctx.headers?.get("accept-language"),
        preferredLocale: typeof preferred === "string" ? preferred : null,
      })
    },
  })
}
