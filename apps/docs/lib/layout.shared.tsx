import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
import { i18n } from "@/lib/i18n"
import { zhCN } from "@fumadocs/language/zh-cn"
import { uiTranslations } from "fumadocs-ui/i18n"
import { openapiTranslations } from "fumadocs-openapi/i18n"
import { appName, gitConfig } from "./shared"

export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .extend(openapiTranslations())
  .preset("zh-CN", zhCN())

export function baseOptions(locale: string): BaseLayoutProps {
  const isZh = locale === "zh-CN"

  return {
    nav: {
      title: appName,
      url: `/${locale}`,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      {
        type: "main",
        text: isZh ? "文档" : "Docs",
        url: `/${locale}`,
      },
    ],
    i18n: {
      defaultLanguage: i18n.defaultLanguage,
      languages: i18n.languages,
      hideLocale: i18n.hideLocale,
    },
  }
}
