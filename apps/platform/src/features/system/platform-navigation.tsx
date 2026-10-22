import { Navigate, useParams } from "@tanstack/react-router"
import type { PlatformNavigationItem } from "@workspace/contracts/platform-system"
import {
  ErrorState,
  LoadingState,
  NotFoundContent,
  PermissionDeniedState,
} from "@workspace/admin"
import { useTranslation } from "react-i18next"
import { usePlatformNavigationQuery } from "./use-platform-navigation"
import { platformNavigationModel } from "./platform-pages"

export function PlatformEmbeddedPage() {
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
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  const node = find(query.data.items)
  if (!node || node.kind !== "iframe" || !node.url) return <NotFoundContent />
  return (
    <iframe
      title={node.name}
      src={node.url}
      className="min-h-[calc(100svh-10rem)] w-full rounded-md border"
      sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  )
}
export function PlatformHomePage() {
  const query = usePlatformNavigationQuery()
  const { t } = useTranslation(["monitor", "files"])
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  const { home } = platformNavigationModel(query.data.items, "/platform", {
    files: t("files:title"),
    monitor: t("title"),
    schedules: t("schedulesTitle"),
  })
  if (!home) return <PermissionDeniedState />
  return <Navigate {...home} replace />
}
