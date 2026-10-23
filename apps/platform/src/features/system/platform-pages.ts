import { FileListQuerySchema } from "@workspace/contracts/files"
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
  ShieldCheckIcon,
  ListTodoIcon,
  BellIcon,
  NetworkIcon,
  BriefcaseIcon,
  BookOpenIcon,
  SlidersHorizontalIcon,
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

// 路由与导航共用页面登记；目录只组织入口，访问仍由每个页面的动作权限决定。
export const platformPages = {
  files: page("files", "platform.file:read", FileListQuerySchema, {}),
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

type PageKey = keyof typeof platformPages
const pagePresentation = {
  organizations: { titleKey: "organization:management", Icon: BuildingIcon },
  users: { titleKey: "system:globalAccounts", Icon: UsersIcon },
  announcements: { titleKey: "announcements:managementTitle", Icon: BellIcon },
  files: { titleKey: "files:title", Icon: FolderIcon },
  employees: { titleKey: "employees:title", Icon: UsersIcon },
  departments: { titleKey: "catalogs:departmentTitle", Icon: NetworkIcon },
  posts: { titleKey: "catalogs:postTitle", Icon: BriefcaseIcon },
  roles: { titleKey: "roles:title", Icon: ShieldCheckIcon },
  sessions: { titleKey: "identity:sessions", Icon: MonitorIcon },
  "login-events": { titleKey: "system:loginLogs", Icon: FileTextIcon },
  "audit-events": { titleKey: "organization:audit", Icon: ClipboardListIcon },
  tasks: { titleKey: "platformTasks:title", Icon: ListTodoIcon },
  schedules: { titleKey: "monitor:schedulesTitle", Icon: ClockIcon },
  monitor: { titleKey: "monitor:title", Icon: MonitorIcon },
  dictionaries: { titleKey: "catalogs:dictionaryTitle", Icon: BookOpenIcon },
  parameters: {
    titleKey: "catalogs:parameterTitle",
    Icon: SlidersHorizontalIcon,
  },
  settings: { titleKey: "organization:platformSettings", Icon: SettingsIcon },
} as const satisfies Record<
  PageKey,
  { titleKey: string; Icon: typeof FolderIcon }
>

type GroupTitleKey =
  `system:${"contentManagement" | "platformTeam" | "securityAudit" | "operationsManagement" | "systemConfiguration"}`
type NavigationEntry =
  | PageKey
  | {
      id: string
      titleKey: GroupTitleKey
      Icon: typeof FolderIcon
      pages: PageKey[]
    }
const navigation: NavigationEntry[] = [
  "organizations",
  "users",
  {
    id: "content",
    titleKey: "system:contentManagement",
    Icon: FileTextIcon,
    pages: ["announcements", "files"],
  },
  {
    id: "team",
    titleKey: "system:platformTeam",
    Icon: UsersIcon,
    pages: ["employees", "departments", "posts", "roles"],
  },
  {
    id: "security",
    titleKey: "system:securityAudit",
    Icon: ShieldCheckIcon,
    pages: ["sessions", "login-events", "audit-events"],
  },
  {
    id: "operations",
    titleKey: "system:operationsManagement",
    Icon: MonitorIcon,
    pages: ["tasks", "schedules", "monitor"],
  },
  {
    id: "configuration",
    titleKey: "system:systemConfiguration",
    Icon: Settings2Icon,
    pages: ["dictionaries", "parameters", "settings"],
  },
]

type PageTarget = (typeof platformPages)[PageKey]["target"]
interface NavigationItem {
  id: string
  titleKey: (typeof pagePresentation)[PageKey]["titleKey"] | GroupTitleKey
  Icon: typeof FolderIcon
  target?: PageTarget
  isActive: boolean
  children: NavigationItem[]
}

export function platformNavigationModel(
  permissions: readonly string[],
  pathname: string
) {
  function authorizedPage(key: PageKey): NavigationItem[] {
    const page = platformPages[key]
    if (!permissions.includes(page.permission)) return []
    return [
      {
        id: key,
        ...pagePresentation[key],
        target: page.target,
        isActive:
          pathname === page.target.to ||
          pathname.startsWith(`${page.target.to}/`),
        children: [],
      },
    ]
  }
  const items: NavigationItem[] = navigation.flatMap((entry) => {
    if (typeof entry === "string") return authorizedPage(entry)
    const children = entry.pages.flatMap(authorizedPage)
    return children.length
      ? [
          {
            id: entry.id,
            titleKey: entry.titleKey,
            Icon: entry.Icon,
            isActive: false,
            children,
          },
        ]
      : []
  })
  const parent = items.find((item) =>
    item.children.some((child) => child.isActive)
  )
  return {
    items,
    home: items[0]?.target ?? items[0]?.children[0]?.target,
    section:
      parent?.children.find((child) => child.isActive) ??
      items.find((item) => item.isActive),
    ancestors: parent ? [parent] : [],
  }
}
