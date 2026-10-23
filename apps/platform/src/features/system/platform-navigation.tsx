import { Navigate, useParams } from "@tanstack/react-router"
import type { PlatformNavigationItem } from "@workspace/contracts/platform-system"
import {
  AdminPage,
  ErrorState,
  LoadingState,
  NotFoundContent,
  PermissionDeniedState,
} from "@workspace/admin"
import { useTranslation } from "react-i18next"
import { usePlatformNavigationQuery } from "./use-platform-navigation"
import { platformNavigationModel } from "./platform-pages"

export function PlatformEmbeddedPage() {
  const { t } = useTranslation("common")

  const { menuId } = useParams({ from: "/platform/embedded/$menuId" })
  const query = usePlatformNavigationQuery()
  const find = (
    nodes: PlatformNavigationItem[]
  ): PlatformNavigationItem | undefined => {
    for (const node of nodes) {
      if (node.id === menuId) return node
      const child = find(node.children)
      if (child) return child
    }
  }
  if (query.isPending)
    return (
      <AdminPage title={t("navigation")}>
        <LoadingState />
      </AdminPage>
    )
  if (query.isError)
    return (
      <AdminPage title={t("navigation")}>
        <ErrorState onRetry={() => void query.refetch()} />
      </AdminPage>
    )
  const node = find(query.data.items)
  if (!node || node.kind !== "iframe" || !node.url)
    return (
      <AdminPage title={t("navigation")}>
        <NotFoundContent />
      </AdminPage>
    )
  return (
    <AdminPage title={node.name}>
      <iframe
        title={node.name}
        src={node.url}
        className="min-h-[calc(100svh-10rem)] w-full rounded-md border"
        sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </AdminPage>
  )
}
export function PlatformHomePage() {
  const query = usePlatformNavigationQuery()
  const { t } = useTranslation(["monitor", "files", "auth"])
  if (query.isPending)
    return (
      <AdminPage title={t("auth:platformTitle")}>
        <LoadingState />
      </AdminPage>
    )
  if (query.isError)
    return (
      <AdminPage title={t("auth:platformTitle")}>
        <ErrorState onRetry={() => void query.refetch()} />
      </AdminPage>
    )
  const { home } = platformNavigationModel(query.data.items, "/platform", {
    files: t("files:title"),
    monitor: t("title"),
    schedules: t("schedulesTitle"),
  })
  if (!home)
    return (
      <AdminPage title={t("auth:platformTitle")}>
        <PermissionDeniedState />
      </AdminPage>
    )
  return <Navigate {...home} replace />
}
