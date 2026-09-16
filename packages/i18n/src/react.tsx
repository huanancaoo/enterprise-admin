import { useEffect, type ReactNode } from "react"
import { I18nextProvider, useTranslation } from "react-i18next"
import type { i18n } from "i18next"
import { syncDocumentLanguage } from "./config"
import type { SupportedLocale } from "./index"

export function UiI18nProvider({
  instance,
  children,
}: {
  instance: i18n
  children: ReactNode
}) {
  useEffect(() => syncDocumentLanguage(instance, document), [instance])
  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>
}

export function useUiLocale(): SupportedLocale {
  const { i18n } = useTranslation()
  return i18n.language as SupportedLocale
}
