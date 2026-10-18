import { z } from "zod"
import {
  PlatformOrganizationQuerySchema,
  PlatformUsersQuerySchema,
  PlatformAuditQuerySchema,
} from "@workspace/contracts/platform"
import {
  LoginLogsQuerySchema,
  PlatformSessionsQuerySchema,
} from "@workspace/contracts/identity-management"
import {
  PlatformEmployeesQuerySchema,
  PlatformSystemQuerySchema,
  PlatformSystemTreeQuerySchema,
  type PlatformNavigationItem,
} from "@workspace/contracts/platform-system"
import { AnnouncementQuerySchema } from "@workspace/contracts/platform-announcements"
import { PlatformTaskQuerySchema } from "@workspace/contracts/platform-tasks"
import { PlatformScheduleQuerySchema } from "@workspace/contracts/platform-schedules"
import {
  BuildingIcon,
  SettingsIcon,
  Settings2Icon,
  UsersIcon,
  FileTextIcon,
  MonitorIcon,
  FolderIcon,
  ClipboardListIcon,
  ClockIcon,
} from "lucide-react"

function page<
  const K extends string,
  const P extends string,
  S extends z.ZodType,
>(
  path: K,
  permission: P,
  query: S,
  search: Record<string, never> | { page: number; pageSize: number }
) {
  return {
    path,
    permission,
    validateSearch: (value: Record<string, unknown>) => query.parse(value),
    target: { to: `/platform/${path}` as const, search },
  }
}
const paged = { page: 1, pageSize: 20 }

// 代码登记决定页面语义；持久菜单仍决定名称、层级、顺序和可见性。
export const platformPages = {
  organizations: page(
    "organizations",
    "platform.organization:read",
    PlatformOrganizationQuerySchema,
    paged
  ),
  users: page("users", "platform.user:read", PlatformUsersQuerySchema, paged),
  employees: page(
    "employees",
    "platform.employee:read",
    PlatformEmployeesQuerySchema,
    paged
  ),
  roles: page("roles", "platform.role:read", PlatformSystemQuerySchema, paged),
  menus: page("menus", "platform.menu:read", PlatformSystemTreeQuerySchema, {}),
  departments: page(
    "departments",
    "platform.department:read",
    PlatformSystemTreeQuerySchema,
    {}
  ),
  posts: page("posts", "platform.post:read", PlatformSystemQuerySchema, paged),
  dictionaries: page(
    "dictionaries",
    "platform.dictionary:read",
    PlatformSystemQuerySchema,
    paged
  ),
  parameters: page(
    "parameters",
    "platform.parameter:read",
    PlatformSystemQuerySchema,
    paged
  ),
  announcements: page(
    "announcements",
    "platform.announcement:read",
    AnnouncementQuerySchema,
    paged
  ),
  "audit-events": page(
    "audit-events",
    "platform.audit:read",
    PlatformAuditQuerySchema,
    paged
  ),
  "login-events": page(
    "login-events",
    "platform.login:read",
    LoginLogsQuerySchema,
    paged
  ),
  sessions: page(
    "sessions",
    "platform.session:read",
    PlatformSessionsQuerySchema,
    paged
  ),
  monitor: page("monitor", "platform.monitor:read", z.object({}), {}),
  schedules: page(
    "schedules",
    "platform.schedule:read",
    PlatformScheduleQuerySchema,
    paged
  ),
  settings: page("settings", "platform.settings:read", z.object({}), {}),
  tasks: page(
    "tasks",
    "platform.task:read",
    PlatformTaskQuerySchema.extend({ taskId: z.uuid().optional() }),
    paged
  ),
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
  Clock: ClockIcon,
}

type Titles = { monitor: string; schedules: string }
function registeredPage(key: string | null) {
  return key && Object.hasOwn(platformPages, key)
    ? platformPages[key as keyof typeof platformPages]
    : undefined
}
function target(node: PlatformNavigationItem) {
  if (node.kind === "iframe")
    return {
      to: "/platform/embedded/$menuId" as const,
      params: { menuId: node.id },
    }
  if (node.kind === "page") return registeredPage(node.routeKey)?.target
}
function titled(
  node: PlatformNavigationItem,
  titles: Titles
): PlatformNavigationItem {
  return {
    ...node,
    name:
      node.routeKey === "monitor" || node.routeKey === "schedules"
        ? titles[node.routeKey]
        : node.name,
  }
}
function matches(node: PlatformNavigationItem, pathname: string) {
  if (node.kind === "iframe")
    return pathname === `/platform/embedded/${node.id}`
  const path =
    node.kind === "page" ? registeredPage(node.routeKey)?.target.to : undefined
  return Boolean(path && (pathname === path || pathname.startsWith(`${path}/`)))
}
function activePath(
  nodes: PlatformNavigationItem[],
  pathname: string
): PlatformNavigationItem[] {
  for (const node of nodes) {
    if (matches(node, pathname)) return [node]
    const children = activePath(node.children, pathname)
    if (children.length) return [node, ...children]
  }
  return []
}
function visibleItems(
  nodes: PlatformNavigationItem[],
  pathname: string,
  titles: Titles
): NavigationItem[] {
  return nodes
    .filter((node) => !node.hidden && node.kind !== "action")
    .flatMap((node) => {
      const children = visibleItems(node.children, pathname, titles)
      if (node.kind === "directory" && !children.length) return []
      return [
        {
          ...titled(node, titles),
          children,
          target: target(node),
          Icon: node.icon ? icons[node.icon] : undefined,
          isActive: matches(node, pathname),
        },
      ]
    })
}
interface NavigationItem extends PlatformNavigationItem {
  children: NavigationItem[]
  target: ReturnType<typeof target>
  Icon: typeof FolderIcon | undefined
  isActive: boolean
}
function firstTarget(nodes: NavigationItem[]): ReturnType<typeof target> {
  for (const node of nodes) {
    if (node.target) return node.target
    const child = firstTarget(node.children)
    if (child) return child
  }
}

// 隐藏只约束可见导航和首页落点；当前位置仍使用完整授权投影，以支持隐藏页面直达。
export function platformNavigationModel(
  nodes: PlatformNavigationItem[],
  pathname: string,
  titles: Titles
) {
  const items = visibleItems(nodes, pathname, titles)
  const selected = activePath(nodes, pathname).map((node) =>
    titled(node, titles)
  )
  return {
    items,
    home: firstTarget(items),
    section: selected.at(-1),
    ancestors: selected.slice(0, -1),
  }
}
