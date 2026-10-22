import { createElement } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useLocation } from "@tanstack/react-router"
import { listPlatformNavigation } from "@workspace/api-client"
import { PlatformNavigationSchema } from "@workspace/contracts/platform-system"
import type { NavMainItem } from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { useTranslation } from "react-i18next"
import { platformNavigationModel } from "./platform-pages"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"

export function usePlatformNavigationQuery() {
  const session = useAuthenticatedSession()!
  const query = useQuery({
    queryKey: ["platform", session.user.id, "navigation"],
    queryFn: async ({ signal }) =>
      PlatformNavigationSchema.parse(
        (await listPlatformNavigation({ signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  return query
}
function navigationItems(
  nodes: ReturnType<typeof platformNavigationModel>["items"]
): NavMainItem[] {
  return nodes.map((node) => ({
    title: node.name,
    icon: node.Icon ? createElement(node.Icon) : undefined,
    isActive: node.isActive,
    ...(node.children.length ? { items: navigationItems(node.children) } : {}),
    ...(node.kind === "external" && node.url
      ? {
          render: (
            <a href={node.url} target="_blank" rel="noopener noreferrer" />
          ),
        }
      : node.target
        ? { render: <Link {...node.target} /> }
        : {}),
  }))
}
export function usePlatformNavigation() {
  const query = usePlatformNavigationQuery()
  const { pathname } = useLocation()
  const { t } = useTranslation(["system", "announcements", "monitor", "files"])
  const model = platformNavigationModel(query.data?.items ?? [], pathname, {
    files: t("files:title"),
    monitor: t("monitor:title"),
    schedules: t("monitor:schedulesTitle"),
  })
  return {
    items: navigationItems(model.items),
    section: pathname.startsWith("/platform/personal-settings")
      ? { name: t("system:personalSettings") }
      : pathname.startsWith("/platform/announcement-inbox")
        ? { name: t("announcements:title") }
        : model.section,
    ancestors: model.ancestors,
    error: query.error,
    retry: () => void query.refetch(),
  }
}
