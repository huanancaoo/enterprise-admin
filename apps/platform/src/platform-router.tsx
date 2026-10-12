import { useLayoutEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { RouterProvider } from "@tanstack/react-router"
import { useUiLocale } from "@workspace/i18n/react"
import { AuthGate, type WorkspaceRouterContext } from "@workspace/admin/auth"
import { router } from "./router"
import { authClient } from "./lib/auth-client"

export function PlatformRouter() {
  const { t } = useTranslation("auth")
  const locale = useUiLocale()
  return (
    <AuthGate client={authClient} restoreTitle={t("platformTitle")}>
      {({ user, queryClient }) => (
        <SessionRouter user={user} queryClient={queryClient} locale={locale} />
      )}
    </AuthGate>
  )
}

function SessionRouter({ user, queryClient, locale }: WorkspaceRouterContext) {
  const sessionId = authClient.useSession().data?.session.id ?? "anonymous"
  const previousSessionId = useRef(sessionId)
  useLayoutEffect(() => {
    // 同一账号的密码变更也会轮换 Session；新会话不能继续使用旧组织或平台 MFA 的路由事实。
    if (previousSessionId.current === sessionId) return
    previousSessionId.current = sessionId
    void queryClient.invalidateQueries({ queryKey: ["auth"] })
    void router.invalidate()
  }, [sessionId, queryClient])
  return (
    <RouterProvider router={router} context={{ user, queryClient, locale }} />
  )
}
