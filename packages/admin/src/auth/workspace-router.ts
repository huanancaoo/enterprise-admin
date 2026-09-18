import { QueryClient } from "@tanstack/react-query"
import type { SupportedLocale } from "@workspace/i18n"
import type { AuthenticatedSession } from "./authenticated-session"

export type WorkspaceRouterContext = {
  user: AuthenticatedSession["user"] | null
  queryClient: QueryClient
  locale: SupportedLocale
}

export function createSessionQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 管理端以服务器为事实来源；翻页用 placeholderData 保留上一页，不靠拉长 staleTime。
        staleTime: 0,
      },
    },
  })
}
