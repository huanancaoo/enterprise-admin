import { useLayoutEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { RouterProvider } from "@tanstack/react-router"
import { useUiLocale } from "@workspace/i18n/react"
import { AuthGate, type WorkspaceRouterContext } from "@workspace/admin/auth"
import { router } from "./router"
import { authClient } from "@/lib/auth-client"

export function TenantRouter() {
  const { t } = useTranslation("organization")
  const locale = useUiLocale()
  return (
    <AuthGate client={authClient} restoreTitle={t("management")}>
      {({ user, queryClient }) => (
        <SessionRouter user={user} queryClient={queryClient} locale={locale} />
      )}
    </AuthGate>
  )
}

function SessionRouter({ user, queryClient, locale }: WorkspaceRouterContext) {
  const userId = user?.id ?? "anonymous"
  const previousUserId = useRef(userId)
  useLayoutEffect(() => {
    // RouterProvider 更新 context 不会重跑 beforeLoad。登录/登出后必须 invalidate，否则会停在已失效的路由上。
    if (previousUserId.current === userId) return
    previousUserId.current = userId
    void router.invalidate()
  }, [userId])
  return (
    <RouterProvider router={router} context={{ user, queryClient, locale }} />
  )
}
