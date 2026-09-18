import { useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createUiI18n, type SupportedLocale } from "@workspace/i18n"
import { UiI18nProvider } from "@workspace/i18n/react"
import { AdminDirectionProvider, ThemeProvider } from "@workspace/admin"

export function StoryProviders({
  locale,
  children,
}: {
  locale: SupportedLocale
  children: ReactNode
}) {
  const [instance] = useState(() => createUiI18n(locale))
  // 以 Story ID 隔离生命周期，切换场景后必须重新经过 MSW。
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  )
  return (
    <UiI18nProvider instance={instance}>
      <AdminDirectionProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        </ThemeProvider>
      </AdminDirectionProvider>
    </UiI18nProvider>
  )
}
