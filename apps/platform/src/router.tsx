import { z } from "zod"
import {
  AnnouncementQuerySchema,
  AnnouncementInboxQuerySchema,
} from "@workspace/contracts/platform-announcements"
import { PlatformTaskQuerySchema } from "@workspace/contracts/platform-tasks"
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router"
import {
  LoadingState,
  NotFoundState,
  RouterErrorComponent,
} from "@workspace/admin"
import { ForgotPasswordPage } from "@workspace/admin/auth"
import type { WorkspaceRouterContext } from "@workspace/admin/auth"
import { apiClient } from "@workspace/api-client"
import {
  PlatformAccessSchema,
  PlatformOrganizationQuerySchema,
  PlatformUsersQuerySchema,
  PlatformAuditQuerySchema,
  type PlatformAccess,
} from "@workspace/contracts/platform"
import {
  LoginLogsQuerySchema,
  PlatformSessionsQuerySchema,
} from "@workspace/contracts/identity-management"
import {
  App,
  PlatformAuthTitlePage,
  PlatformEmailVerifiedPage,
  PlatformLayout,
  PlatformLoginPage,
  PlatformMfaPage,
  PlatformAccessDeniedPage,
  PlatformResetPasswordPage,
} from "./App"
import { authClient } from "./lib/auth-client"
import { PlatformPermission } from "./features/system/permission"
import {
  PlatformSystemQuerySchema,
  PlatformSystemTreeQuerySchema,
  PlatformEmployeesQuerySchema,
  PlatformRoleEmployeesQuerySchema,
  PlatformDictionaryItemsQuerySchema,
} from "@workspace/contracts/platform-system"

import { rejectPlatformAccess } from "./lib/platform-access-failure"

const PlatformSettingsPage = lazyRouteComponent(
  () => import("./features/settings-page"),
  "PlatformSettingsPage"
)
const PlatformPersonalSettingsPage = lazyRouteComponent(
  () => import("./features/personal-settings-page"),
  "PlatformPersonalSettingsPage"
)
const PlatformAuditPage = lazyRouteComponent(
  () => import("./features/audit/page"),
  "PlatformAuditPage"
)
const PlatformOrganizationsPage = lazyRouteComponent(
  () => import("./features/organizations/pages"),
  "PlatformOrganizationsPage"
)
const PlatformOrganizationDetailPage = lazyRouteComponent(
  () => import("./features/organizations/pages"),
  "PlatformOrganizationDetailPage"
)
const PlatformUsersPage = lazyRouteComponent(
  () => import("./features/users/pages"),
  "PlatformUsersPage"
)
const PlatformLoginEventsPage = lazyRouteComponent(
  () => import("./features/identity/login-events-page"),
  "PlatformLoginEventsPage"
)
const PlatformSessionsPage = lazyRouteComponent(
  () => import("./features/identity/sessions-page"),
  "PlatformSessionsPage"
)
const PlatformUserDetailPage = lazyRouteComponent(
  () => import("./features/users/pages"),
  "PlatformUserDetailPage"
)

const PlatformEmployeesPage = lazyRouteComponent(
  () => import("./features/system/employees"),
  "PlatformEmployeesPage"
)
const PlatformEmployeeCreatePage = lazyRouteComponent(
  () => import("./features/system/employees"),
  "PlatformEmployeeCreatePage"
)
const PlatformEmployeeGrantPage = lazyRouteComponent(
  () => import("./features/system/employees"),
  "PlatformEmployeeGrantPage"
)
const PlatformEmployeeDetailPage = lazyRouteComponent(
  () => import("./features/system/employees"),
  "PlatformEmployeeDetailPage"
)
const PlatformRolesPage = lazyRouteComponent(
  () => import("./features/system/roles"),
  "PlatformRolesPage"
)
const PlatformRolePermissionsPage = lazyRouteComponent(
  () => import("./features/system/roles"),
  "PlatformRolePermissionsPage"
)
const PlatformRoleEmployeesPage = lazyRouteComponent(
  () => import("./features/system/roles"),
  "PlatformRoleEmployeesPage"
)
const PlatformMenusPage = lazyRouteComponent(
  () => import("./features/system/tree-pages"),
  "PlatformMenusPage"
)
const PlatformDepartmentsPage = lazyRouteComponent(
  () => import("./features/system/tree-pages"),
  "PlatformDepartmentsPage"
)
const PlatformPostsPage = lazyRouteComponent(
  () => import("./features/system/catalog-pages"),
  "PlatformPostsPage"
)
const PlatformDictionariesPage = lazyRouteComponent(
  () => import("./features/system/catalog-pages"),
  "PlatformDictionariesPage"
)
const PlatformDictionaryItemsPage = lazyRouteComponent(
  () => import("./features/system/catalog-pages"),
  "PlatformDictionaryItemsPage"
)
const PlatformParametersPage = lazyRouteComponent(
  () => import("./features/system/catalog-pages"),
  "PlatformParametersPage"
)
const PlatformHomePage = lazyRouteComponent(
  () => import("./features/system/platform-navigation"),
  "PlatformHomePage"
)
const PlatformEmbeddedPage = lazyRouteComponent(
  () => import("./features/system/platform-navigation"),
  "PlatformEmbeddedPage"
)

const PlatformAnnouncementsRoute = lazyRouteComponent(
  () => import("./features/announcements/routes"),
  "PlatformAnnouncementsRoute"
)
const PlatformAnnouncementCreateRoute = lazyRouteComponent(
  () => import("./features/announcements/routes"),
  "PlatformAnnouncementCreateRoute"
)
const PlatformAnnouncementPreviewRoute = lazyRouteComponent(
  () => import("./features/announcements/routes"),
  "PlatformAnnouncementPreviewRoute"
)
const PlatformAnnouncementEditRoute = lazyRouteComponent(
  () => import("./features/announcements/routes"),
  "PlatformAnnouncementEditRoute"
)
const PlatformAnnouncementReadersRoute = lazyRouteComponent(
  () => import("./features/announcements/routes"),
  "PlatformAnnouncementReadersRoute"
)
const PlatformAnnouncementInboxRoute = lazyRouteComponent(
  () => import("./features/announcements/routes"),
  "PlatformAnnouncementInboxRoute"
)
const PlatformAnnouncementReadRoute = lazyRouteComponent(
  () => import("./features/announcements/routes"),
  "PlatformAnnouncementReadRoute"
)
const PlatformTasksRoute = lazyRouteComponent(
  () => import("./features/tasks/route"),
  "PlatformTasksRoute"
)

const rootRoute = createRootRouteWithContext<WorkspaceRouterContext>()({
  component: App,
})
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: ({ context }) => {
    if (context.user) throw redirect({ to: "/platform" })
  },
  component: PlatformLoginPage,
})
const platformMfaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/platform/mfa",
  validateSearch: (search: Record<string, unknown>) => ({
    challenge: search.challenge === true || search.challenge === "true",
  }),
  beforeLoad: ({ context, search }) => {
    // 添加账号时旧账号上下文会短暂保留；原生登录挑战通过显式标记进入验证页。
    if (!search.challenge)
      throw redirect({ to: context.user ? "/platform" : "/login" })
  },
  component: PlatformMfaPage,
})
const addAccountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/add-account",
  component: PlatformLoginPage,
})
const platformAccessDeniedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/platform/access-denied",
  component: PlatformAccessDeniedPage,
})
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: () => <PlatformAuthTitlePage Page={ForgotPasswordPage} />,
})
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.token === "string" ? { token: search.token } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  component: PlatformResetPasswordPage,
})
const emailVerifiedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/verified",
  validateSearch: (search: Record<string, unknown>) =>
    typeof search.error === "string" ? { error: search.error } : {},
  component: PlatformEmailVerifiedPage,
})
const platformRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/platform",
  beforeLoad: async ({ context }) => {
    if (!context.user) throw redirect({ to: "/login" })
    try {
      const response = await apiClient<{ data: PlatformAccess }>(
        "/api/v1/me/platform"
      )
      return { platformAccess: PlatformAccessSchema.parse(response.data) }
    } catch (error) {
      await rejectPlatformAccess(error, {
        queryClient: context.queryClient,
        userId: context.user.id,
        restoreSession: () => authClient.$store.notify("$sessionSignal"),
        exit: (destination) => {
          throw redirect(destination)
        },
      })
      throw error
    }
  },
  component: PlatformLayout,
})
const platformIndexRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "/",
  component: PlatformHomePage,
})
const platformOrganizationsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "organizations",
  validateSearch: (search) => PlatformOrganizationQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.organization:read">
      <PlatformOrganizationsPage />
    </PlatformPermission>
  ),
})
const platformOrganizationDetailRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "organizations/$organizationId",
  component: () => (
    <PlatformPermission action="platform.organization:read">
      <PlatformOrganizationDetailPage />
    </PlatformPermission>
  ),
})
const platformUsersRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "users",
  validateSearch: (search) => PlatformUsersQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.user:read">
      <PlatformUsersPage />
    </PlatformPermission>
  ),
})
const platformUserDetailRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "users/$userId",
  component: () => (
    <PlatformPermission action="platform.user:read">
      <PlatformUserDetailPage />
    </PlatformPermission>
  ),
})
const platformAuditRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "audit-events",
  validateSearch: (search) => PlatformAuditQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.audit:read">
      <PlatformAuditPage />
    </PlatformPermission>
  ),
})
const platformLoginEventsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "login-events",
  validateSearch: (search) => LoginLogsQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.login:read">
      <PlatformLoginEventsPage />
    </PlatformPermission>
  ),
})
const platformSessionsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "sessions",
  validateSearch: (search) => PlatformSessionsQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.session:read">
      <PlatformSessionsPage />
    </PlatformPermission>
  ),
})
const personalSettingsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "personal-settings",
  component: PlatformPersonalSettingsPage,
})
const platformSettingsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "settings",
  component: () => (
    <PlatformPermission action="platform.settings:read">
      <PlatformSettingsPage />
    </PlatformPermission>
  ),
})
const employeesRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "employees",
  validateSearch: (search) => PlatformEmployeesQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.employee:read">
      <PlatformEmployeesPage />
    </PlatformPermission>
  ),
})

const employeeCreateRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "employees/new",
  component: () => (
    <PlatformPermission action="platform.authorization:manage">
      <PlatformEmployeeCreatePage />
    </PlatformPermission>
  ),
})

const employeeGrantRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "employees/grant",
  component: () => (
    <PlatformPermission action="platform.authorization:manage">
      <PlatformEmployeeGrantPage />
    </PlatformPermission>
  ),
})

const employeeDetailRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "employees/$employeeId",
  component: () => (
    <PlatformPermission action="platform.employee:read">
      <PlatformEmployeeDetailPage />
    </PlatformPermission>
  ),
})

const rolesRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "roles",
  validateSearch: (search) => PlatformSystemQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.role:read">
      <PlatformRolesPage />
    </PlatformPermission>
  ),
})

const rolePermissionsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "roles/$roleId/permissions",
  component: () => (
    <PlatformPermission action="platform.role:read">
      <PlatformRolePermissionsPage />
    </PlatformPermission>
  ),
})

const roleEmployeesRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "roles/$roleId/employees",
  validateSearch: (search) =>
    PlatformRoleEmployeesQuerySchema.parse({
      ...search,
      assigned: String(search.assigned ?? true),
    }),
  component: () => (
    <PlatformPermission action="platform.authorization:manage">
      <PlatformRoleEmployeesPage />
    </PlatformPermission>
  ),
})

const menusRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "menus",
  validateSearch: (search) => PlatformSystemTreeQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.menu:read">
      <PlatformMenusPage />
    </PlatformPermission>
  ),
})

const departmentsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "departments",
  validateSearch: (search) => PlatformSystemTreeQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.department:read">
      <PlatformDepartmentsPage />
    </PlatformPermission>
  ),
})

const postsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "posts",
  validateSearch: (search) => PlatformSystemQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.post:read">
      <PlatformPostsPage />
    </PlatformPermission>
  ),
})

const dictionariesRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "dictionaries",
  validateSearch: (search) => PlatformSystemQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.dictionary:read">
      <PlatformDictionariesPage />
    </PlatformPermission>
  ),
})

const dictionaryItemsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "dictionaries/$dictionaryId/items",
  validateSearch: (search) => PlatformDictionaryItemsQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.dictionary:read">
      <PlatformDictionaryItemsPage />
    </PlatformPermission>
  ),
})

const parametersRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "parameters",
  validateSearch: (search) => PlatformSystemQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.parameter:read">
      <PlatformParametersPage />
    </PlatformPermission>
  ),
})

const embeddedRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "embedded/$menuId",
  component: PlatformEmbeddedPage,
})

const announcementsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "announcements",
  validateSearch: (search) => AnnouncementQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.announcement:read">
      <PlatformAnnouncementsRoute />
    </PlatformPermission>
  ),
})

const announcementCreateRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "announcements/new",
  component: () => (
    <PlatformPermission action="platform.announcement:create">
      <PlatformAnnouncementCreateRoute />
    </PlatformPermission>
  ),
})

const announcementPreviewRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "announcements/$announcementId",
  component: () => (
    <PlatformPermission action="platform.announcement:read">
      <PlatformAnnouncementPreviewRoute />
    </PlatformPermission>
  ),
})
const announcementEditRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "announcements/$announcementId/edit",
  component: () => (
    <PlatformPermission action="platform.announcement:update">
      <PlatformAnnouncementEditRoute />
    </PlatformPermission>
  ),
})

const announcementReadersRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "announcements/$announcementId/readers",
  validateSearch: (search) =>
    AnnouncementInboxQuerySchema.pick({ page: true, pageSize: true }).parse(
      search
    ),
  component: () => (
    <PlatformPermission action="platform.announcement:readers">
      <PlatformAnnouncementReadersRoute />
    </PlatformPermission>
  ),
})

const announcementInboxRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "announcement-inbox",
  validateSearch: (search) => AnnouncementInboxQuerySchema.parse(search),
  component: PlatformAnnouncementInboxRoute,
})

const announcementReadRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "announcement-inbox/$announcementId",
  component: PlatformAnnouncementReadRoute,
})

const tasksRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "tasks",
  validateSearch: (search) =>
    PlatformTaskQuerySchema.extend({ taskId: z.uuid().optional() }).parse(
      search
    ),
  component: () => (
    <PlatformPermission action="platform.task:read">
      <PlatformTasksRoute />
    </PlatformPermission>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/platform" })
  },
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    loginRoute,
    addAccountRoute,
    forgotPasswordRoute,
    platformMfaRoute,
    platformAccessDeniedRoute,
    resetPasswordRoute,
    emailVerifiedRoute,
    platformRoute.addChildren([
      platformIndexRoute,
      platformOrganizationsRoute,
      platformOrganizationDetailRoute,
      platformUsersRoute,
      platformUserDetailRoute,
      platformAuditRoute,
      platformLoginEventsRoute,
      platformSessionsRoute,
      platformSettingsRoute,
      personalSettingsRoute,
      announcementsRoute,
      announcementCreateRoute,
      announcementEditRoute,
      announcementPreviewRoute,
      announcementReadersRoute,
      announcementInboxRoute,
      announcementReadRoute,
      tasksRoute,

      employeesRoute,
      employeeCreateRoute,
      employeeGrantRoute,
      employeeDetailRoute,
      rolesRoute,
      rolePermissionsRoute,
      roleEmployeesRoute,
      menusRoute,
      departmentsRoute,
      postsRoute,
      dictionariesRoute,
      dictionaryItemsRoute,
      parametersRoute,
      embeddedRoute,
    ]),
  ]),
  context: {
    user: null,
    queryClient: undefined!,
    locale: "zh-CN",
  },
  defaultPreload: "intent",
  // 主面板独立滚动后，换页仍须从页面顶部开始。
  scrollToTopSelectors: ['[data-slot="sidebar-inset"]'],
  defaultNotFoundComponent: NotFoundState,
  defaultErrorComponent: RouterErrorComponent,
  defaultPendingComponent: LoadingState,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
