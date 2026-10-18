import { createElement } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useLocation } from "@tanstack/react-router"
import { listPlatformNavigation } from "@workspace/api-client"
import {
  PlatformNavigationSchema,
  type PlatformNavigationItem,
} from "@workspace/contracts/platform-system"
import type { NavMainItem } from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { useTranslation } from "react-i18next"
import {
  BuildingIcon,
  SettingsIcon,
  Settings2Icon,
  UsersIcon,
  FileTextIcon,
  MonitorIcon,
  FolderIcon,
  ClipboardListIcon,
} from "lucide-react"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"

const internalPages = {
  organizations: "/platform/organizations",
  users: "/platform/users",
  employees: "/platform/employees",
  roles: "/platform/roles",
  menus: "/platform/menus",
  departments: "/platform/departments",
  posts: "/platform/posts",
  dictionaries: "/platform/dictionaries",
  parameters: "/platform/parameters",
  announcements: "/platform/announcements",
  "audit-events": "/platform/audit-events",
  "login-events": "/platform/login-events",
  sessions: "/platform/sessions",
  monitor: "/platform/monitor",
  schedules: "/platform/schedules",
  settings: "/platform/settings",
  tasks: "/platform/tasks",
} as const
const icons: Record<string, typeof FolderIcon> = {
  Building: BuildingIcon,
  Settings: SettingsIcon,
  Settings2: Settings2Icon,
  Users: UsersIcon,
  FileText: FileTextIcon,
  Monitor: MonitorIcon,
  ClipboardList: ClipboardListIcon,
  Folder: FolderIcon,
}
export function platformPagePath(key: string | null) {
  return key && key in internalPages
    ? internalPages[key as keyof typeof internalPages]
    : undefined
}
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
function activePath(
  nodes: PlatformNavigationItem[],
  pathname: string
): PlatformNavigationItem[] {
  for (const node of nodes) {
    const path = platformPagePath(node.routeKey)
    if (
      (path && (pathname === path || pathname.startsWith(`${path}/`))) ||
      (node.kind === "iframe" && pathname === `/platform/embedded/${node.id}`)
    )
      return [node]
    const children = activePath(node.children, pathname)
    if (children.length) return [node, ...children]
  }
  return []
}
function navigationItems(
  nodes: PlatformNavigationItem[],
  pathname: string,
  monitorTitle: string,
  scheduleTitle: string
): NavMainItem[] {
  return nodes
    .filter((node) => !node.hidden && node.kind !== "action")
    .flatMap((node) => {
      const path = platformPagePath(node.routeKey)
      const Icon = node.icon ? icons[node.icon] : undefined
      const children = navigationItems(
        node.children,
        pathname,
        monitorTitle,
        scheduleTitle
      )
      // 授权投影保留隐藏节点供直达；导航移除隐藏子项后不留下空目录。
      if (node.kind === "directory" && children.length === 0) return []
      const render =
        node.kind === "external" && node.url ? (
          <a href={node.url} target="_blank" rel="noopener noreferrer" />
        ) : node.kind === "iframe" ? (
          <Link to="/platform/embedded/$menuId" params={{ menuId: node.id }} />
        ) : path === "/platform/menus" || path === "/platform/departments" ? (
          <Link to={path} search={{}} />
        ) : path === "/platform/settings" || path === "/platform/monitor" ? (
          <Link to={path} />
        ) : path ? (
          <Link to={path} search={{ page: 1, pageSize: 20 }} />
        ) : undefined
      return [
        {
          title:
            node.routeKey === "monitor"
              ? monitorTitle
              : node.routeKey === "schedules"
                ? scheduleTitle
                : node.name,
          icon: Icon ? createElement(Icon) : undefined,
          isActive: Boolean(
            path
              ? pathname === path || pathname.startsWith(`${path}/`)
              : node.kind === "iframe" &&
                  pathname === `/platform/embedded/${node.id}`
          ),
          ...(children.length ? { items: children } : {}),
          ...(render ? { render } : {}),
        },
      ]
    })
}
export function usePlatformNavigation() {
  const query = usePlatformNavigationQuery()
  const { pathname } = useLocation()
  const { t } = useTranslation(["system", "announcements", "monitor"])
  const selected = activePath(query.data?.items ?? [], pathname)
  return {
    items: navigationItems(
      query.data?.items ?? [],
      pathname,
      t("monitor:title"),
      t("monitor:schedulesTitle")
    ),
    section: pathname.startsWith("/platform/personal-settings")
      ? { name: t("system:personalSettings") }
      : pathname.startsWith("/platform/announcement-inbox")
        ? { name: t("announcements:title") }
        : selected.at(-1)?.routeKey === "monitor"
          ? { ...selected.at(-1)!, name: t("monitor:title") }
          : selected.at(-1)?.routeKey === "schedules"
            ? { ...selected.at(-1)!, name: t("monitor:schedulesTitle") }
            : selected.at(-1),
    ancestors: selected.slice(0, -1),
    error: query.error,
    retry: () => void query.refetch(),
  }
}
