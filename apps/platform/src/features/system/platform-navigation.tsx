import { Navigate, useParams } from "@tanstack/react-router"
import type { PlatformNavigationItem } from "@workspace/contracts/platform-system"
import {
  ErrorState,
  LoadingState,
  NotFoundContent,
  PermissionDeniedState,
} from "@workspace/admin"
import {
  platformPagePath,
  usePlatformNavigationQuery,
} from "./use-platform-navigation"

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
  const find = (
    nodes: PlatformNavigationItem[]
  ): PlatformNavigationItem | undefined => {
    for (const node of nodes) {
      if (node.hidden) continue
      if (
        (node.kind === "page" && platformPagePath(node.routeKey)) ||
        node.kind === "iframe"
      )
        return node
      const child = find(node.children)
      if (child) return child
    }
  }
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  const first = find(query.data.items)
  if (!first) return <PermissionDeniedState />
  if (first.kind === "iframe")
    return (
      <Navigate
        to="/platform/embedded/$menuId"
        params={{ menuId: first.id }}
        replace
      />
    )
  const path = platformPagePath(first.routeKey)!
  if (path === "/platform/menus" || path === "/platform/departments")
    return <Navigate to={path} search={{}} replace />
  if (path === "/platform/settings") return <Navigate to={path} replace />
  return <Navigate to={path} search={{ page: 1, pageSize: 20 }} replace />
}
