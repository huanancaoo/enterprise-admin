import { FileListQuerySchema } from "@workspace/contracts/files"
import { z } from "zod"
import { PlatformScheduleRunsQuerySchema } from "@workspace/contracts/platform-schedules"
import { AnnouncementInboxQuerySchema } from "@workspace/contracts/platform-announcements"
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router"
import {
  LoadingState,
  RouterNotFoundComponent,
  NotFoundState,
  RouterErrorComponent,
} from "@workspace/admin"
import { ForgotPasswordPage } from "@workspace/admin/auth"
import type { WorkspaceRouterContext } from "@workspace/admin/auth"
import { apiClient } from "@workspace/api-client"
import {
  PlatformAccessSchema,
  type PlatformAccess,
} from "@workspace/contracts/platform"
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
import { platformPages } from "./features/system/platform-pages"
import {
  PlatformRoleEmployeesQuerySchema,
  PlatformDictionaryItemsQuerySchema,
} from "@workspace/contracts/platform-system"

import { rejectPlatformAccess } from "./lib/platform-access-failure"
import {
  PlatformSchedulesPage,
  PlatformScheduleRunsPage,
} from "./features/schedules/pages"
import { PlatformMonitorPage } from "./features/monitor/page"
import { PlatformSettingsPage } from "./features/settings-page"
import { PlatformPersonalSettingsPage } from "./features/personal-settings-page"
import { PlatformAuditPage } from "./features/audit/page"
import {
  PlatformOrganizationsPage,
  PlatformOrganizationDetailPage,
} from "./features/organizations/pages"
import {
  PlatformUsersPage,
  PlatformUserDetailPage,
} from "./features/users/pages"
import { PlatformLoginEventsPage } from "./features/identity/login-events-page"
import { PlatformSessionsPage } from "./features/identity/sessions-page"
import {
  PlatformEmployeesPage,
  PlatformEmployeeCreatePage,
  PlatformEmployeeGrantPage,
  PlatformEmployeeDetailPage,
} from "./features/system/employees"
import {
  PlatformRolesPage,
  PlatformRolePermissionsPage,
  PlatformRoleEmployeesPage,
} from "./features/system/roles"
import {
  PlatformMenusPage,
  PlatformDepartmentsPage,
} from "./features/system/tree-pages"
import {
  PlatformPostsPage,
  PlatformDictionariesPage,
  PlatformDictionaryItemsPage,
  PlatformParametersPage,
} from "./features/system/catalog-pages"
import {
  PlatformHomePage,
  PlatformEmbeddedPage,
} from "./features/system/platform-navigation"
import {
  PlatformAnnouncementsRoute,
  PlatformAnnouncementCreateRoute,
  PlatformAnnouncementPreviewRoute,
  PlatformAnnouncementEditRoute,
  PlatformAnnouncementReadersRoute,
  PlatformAnnouncementInboxRoute,
  PlatformAnnouncementReadRoute,
} from "./features/announcements/routes"
import { PlatformTasksRoute } from "./features/tasks/route"
import { FilesRoute } from "./features/files/files-workspace"
import { FileDetailRoute } from "./features/files/file-detail-route"

// 页头随路由同步挂载；较重的正文在页面内容边界内按需加载。
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
  notFoundComponent: RouterNotFoundComponent,
})
const platformIndexRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "/",
  component: PlatformHomePage,
})
const platformOrganizationsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: platformPages.organizations.path,
  validateSearch: platformPages.organizations.validateSearch,
  component: () => (
    <PlatformPermission action={platformPages.organizations.permission}>
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
  path: platformPages.users.path,
  validateSearch: platformPages.users.validateSearch,
  component: () => (
    <PlatformPermission action={platformPages.users.permission}>
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
  path: platformPages["audit-events"].path,
  validateSearch: platformPages["audit-events"].validateSearch,
  component: () => (
    <PlatformPermission action={platformPages["audit-events"].permission}>
      <PlatformAuditPage />
    </PlatformPermission>
  ),
})
const platformLoginEventsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: platformPages["login-events"].path,
  validateSearch: platformPages["login-events"].validateSearch,
  component: () => (
    <PlatformPermission action={platformPages["login-events"].permission}>
      <PlatformLoginEventsPage />
    </PlatformPermission>
  ),
})
const platformSessionsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: platformPages.sessions.path,
  validateSearch: platformPages.sessions.validateSearch,
  component: () => (
    <PlatformPermission action={platformPages.sessions.permission}>
      <PlatformSessionsPage />
    </PlatformPermission>
  ),
})
const platformMonitorRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: platformPages.monitor.path,
  component: () => (
    <PlatformPermission action={platformPages.monitor.permission}>
      <PlatformMonitorPage />
    </PlatformPermission>
  ),
})
const platformSchedulesRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: platformPages.schedules.path,
  validateSearch: platformPages.schedules.validateSearch,
  component: () => (
    <PlatformPermission action={platformPages.schedules.permission}>
      <PlatformSchedulesPage />
    </PlatformPermission>
  ),
})
const platformScheduleRunsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "schedules/$scheduleId/runs",
  validateSearch: (search) => PlatformScheduleRunsQuerySchema.parse(search),
  component: () => (
    <PlatformPermission action="platform.schedule:read">
      <PlatformPermission action="platform.monitor:read">
        <PlatformScheduleRunsPage />
      </PlatformPermission>
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
  path: platformPages.settings.path,
  component: () => (
    <PlatformPermission action={platformPages.settings.permission}>
      <PlatformSettingsPage />
    </PlatformPermission>
  ),
})
const employeesRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: platformPages.employees.path,
  validateSearch: platformPages.employees.validateSearch,
  component: () => (
    <PlatformPermission action={platformPages.employees.permission}>
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
  path: platformPages.roles.path,
  validateSearch: platformPages.roles.validateSearch,
  component: () => (
    <PlatformPermission action={platformPages.roles.permission}>
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
  path: platformPages.menus.path,
  validateSearch: platformPages.menus.validateSearch,
  component: () => (
    <PlatformPermission action={platformPages.menus.permission}>
      <PlatformMenusPage />
    </PlatformPermission>
  ),
})

const departmentsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: platformPages.departments.path,
  validateSearch: platformPages.departments.validateSearch,
  component: () => (
    <PlatformPermission action={platformPages.departments.permission}>
      <PlatformDepartmentsPage />
    </PlatformPermission>
  ),
})

const postsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: platformPages.posts.path,
  validateSearch: platformPages.posts.validateSearch,
  component: () => (
    <PlatformPermission action={platformPages.posts.permission}>
      <PlatformPostsPage />
    </PlatformPermission>
  ),
})

const dictionariesRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: platformPages.dictionaries.path,
  validateSearch: platformPages.dictionaries.validateSearch,
  component: () => (
    <PlatformPermission action={platformPages.dictionaries.permission}>
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
  path: platformPages.parameters.path,
  validateSearch: platformPages.parameters.validateSearch,
  component: () => (
    <PlatformPermission action={platformPages.parameters.permission}>
      <PlatformParametersPage />
    </PlatformPermission>
  ),
})

const embeddedRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "embedded/$menuId",
  component: PlatformEmbeddedPage,
})

const filesRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "files",
  validateSearch: FileListQuerySchema,
  component: FilesRoute,
})
const fileDetailRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "files/entries/$entryId",
  validateSearch: z.object({ versionId: z.uuid().optional() }),
  component: FileDetailRoute,
})

const announcementsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: platformPages.announcements.path,
  validateSearch: platformPages.announcements.validateSearch,
  component: () => (
    <PlatformPermission action={platformPages.announcements.permission}>
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
  path: platformPages.tasks.path,
  validateSearch: platformPages.tasks.validateSearch,
  component: () => (
    <PlatformPermission action={platformPages.tasks.permission}>
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
      platformMonitorRoute,
      platformSchedulesRoute,
      platformScheduleRunsRoute,
      platformSettingsRoute,
      personalSettingsRoute,
      filesRoute,
      fileDetailRoute,
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
  scrollToTopSelectors: ['[data-slot="page-scroll"]'],
  defaultNotFoundComponent: NotFoundState,
  defaultErrorComponent: RouterErrorComponent,
  defaultPendingComponent: LoadingState,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
