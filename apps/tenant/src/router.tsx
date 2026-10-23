import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router"
import {
  LoadingState,
  RouterNotFoundComponent,
  NotFoundState,
  RouterErrorComponent,
} from "@workspace/admin"
import type { WorkspaceRouterContext } from "@workspace/admin/auth"
import { ForgotPasswordPage } from "@workspace/admin/auth"
import { getWorkspaceOrganizationsOptions } from "@workspace/api-client"
import { OrganizationRoleDirectoryQuerySchema } from "@workspace/contracts"
import { AuditEventsQuerySchema } from "@workspace/contracts/audit"
import { FileListQuerySchema } from "@workspace/contracts/files"
import { CapabilityPageQuerySchema } from "@workspace/contracts/framework-capabilities"
import { PersonalLoginLogsQuerySchema } from "@workspace/contracts/identity-management"
import { AnnouncementInboxQuerySchema } from "@workspace/contracts/platform-announcements"
import { ProjectListQuerySchema } from "@workspace/contracts/project-query"
import {
  App,
  TenantAcceptInvitationPage,
  TenantAuthTitlePage,
  TenantEmailVerifiedPage,
  TenantLoginPage,
  TenantMfaPage,
  TenantResetPasswordPage,
} from "./App"
import { fileDetailSearchSchema } from "./features/files/file-detail-search"
import { memberDirectorySearchSchema } from "./features/organization/organization-directory"
import { taskCenterSearchSchema } from "./features/tasks/task-center-search"
import { NotificationsRoute } from "./features/notifications/notifications-route"
import { TasksRoute } from "./features/tasks/tasks-route"
import { ProjectsRoute } from "./features/projects/projects-route"
import { IntegrationsRoute } from "./features/integrations/integrations-route"
import { FilesRoute } from "./features/files/files-route"
import { FileDetailRoute } from "./features/files/file-detail-route"
import { ProjectDetailRoute } from "./features/projects/project-detail-route"
import { AdminLayout } from "./components/admin-layout"
import { MembersRoute } from "./features/organization/members-route"
import { RolesRoute } from "./features/organization/roles-route"
import { AuditEventsRoute } from "./features/organization/audit-events-route"
import { OrganizationGate } from "./components/organization-workspace"
import {
  PersonalLocaleSettingsRoute,
  OrganizationLocaleSettingsPage,
} from "./features/settings/locale-settings"
import { PersonalLoginEventsRoute } from "./features/settings/login-events-route"
import {
  TenantAnnouncementInboxRoute,
  TenantAnnouncementReadRoute,
} from "./features/announcements/announcement-routes"

// 页头随路由同步挂载；较重的正文在页面内容边界内按需加载。
const rootRoute = createRootRouteWithContext<WorkspaceRouterContext>()({
  component: App,
})

function invitationIdFromRedirect(redirectTo: string | undefined) {
  const match = redirectTo?.match(/^\/accept-invitation\/([0-9a-f-]+)$/)
  return match?.[1]
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>) => {
    const redirectTo = search.redirect
    if (
      typeof redirectTo === "string" &&
      /^\/accept-invitation\/[0-9a-f-]+$/.test(redirectTo)
    ) {
      return { redirect: redirectTo }
    }
    return {}
  },
  beforeLoad: ({ context, search }) => {
    if (!context.user) return
    const invitationId = invitationIdFromRedirect(search.redirect)
    if (invitationId) {
      throw redirect({
        to: "/accept-invitation/$invitationId",
        params: { invitationId },
      })
    }
    throw redirect({ to: "/app" })
  },
  component: TenantLoginPage,
})
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: () => <TenantAuthTitlePage Page={ForgotPasswordPage} />,
})
const addAccountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/add-account",
  component: TenantLoginPage,
})
const mfaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mfa",
  component: TenantMfaPage,
})
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.token === "string" ? { token: search.token } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  component: TenantResetPasswordPage,
})
const emailVerifiedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/verified",
  validateSearch: (search: Record<string, unknown>) =>
    typeof search.error === "string" ? { error: search.error } : {},
  component: TenantEmailVerifiedPage,
})
const acceptInvitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accept-invitation/$invitationId",
  component: TenantAcceptInvitationPage,
})
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/app" })
  },
})
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: "/login" })
  },
  component: Outlet,
})
const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  loader: async ({ context }) => {
    const organizations = await context.queryClient.query({
      ...getWorkspaceOrganizationsOptions(),
      staleTime: "static",
    })
    const only = organizations.length === 1 ? organizations[0] : undefined
    if (only?.status === "ACTIVE") {
      throw redirect({
        to: "/app/projects/$organizationId",
        params: { organizationId: only.id },
      })
    }
    throw redirect({ to: "/app/select-organization" })
  },
})
// 进入门不能套工作台：此时还没有租户可工作。
const organizationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/select-organization",
  loader: ({ context }) =>
    context.queryClient.query({
      ...getWorkspaceOrganizationsOptions(),
      staleTime: "static",
    }),
  component: OrganizationGate,
})
// 工作台挂在 /projects 下，进入门仍是 /app 的兄弟路由。不用 pathless id，以免改写 useParams 的 from。
// 组织页面由各自的 useQuery 持有数据请求；路由 loader 不能同时等待同一查询，
// 否则语言或组织切换时卸载观察者会取消 loader，进入路由错误页。
const projectsLayoutRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects",
  component: AdminLayout,
  notFoundComponent: RouterNotFoundComponent,
})
const projectsRoute = createRoute({
  getParentRoute: () => projectsLayoutRoute,
  path: "/$organizationId",
  validateSearch: ProjectListQuerySchema,
  component: ProjectsRoute,
})
const projectDetailRoute = createRoute({
  getParentRoute: () => projectsLayoutRoute,
  path: "/$organizationId/$projectId",
  component: ProjectDetailRoute,
})
const filesLayoutRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/files",
  component: AdminLayout,
  notFoundComponent: RouterNotFoundComponent,
})
const filesRoute = createRoute({
  getParentRoute: () => filesLayoutRoute,
  path: "/$organizationId",
  validateSearch: FileListQuerySchema,
  component: FilesRoute,
})
const fileDetailRoute = createRoute({
  getParentRoute: () => filesLayoutRoute,
  path: "/$organizationId/entries/$entryId",
  validateSearch: fileDetailSearchSchema,
  component: FileDetailRoute,
})
const notificationsLayoutRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/notifications",
  component: AdminLayout,
  notFoundComponent: RouterNotFoundComponent,
})
const notificationsRoute = createRoute({
  getParentRoute: () => notificationsLayoutRoute,
  path: "/$organizationId",
  validateSearch: CapabilityPageQuerySchema,
  component: NotificationsRoute,
})
const tasksLayoutRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tasks",
  component: AdminLayout,
  notFoundComponent: RouterNotFoundComponent,
})
const tasksRoute = createRoute({
  getParentRoute: () => tasksLayoutRoute,
  path: "/$organizationId",
  validateSearch: taskCenterSearchSchema,
  component: TasksRoute,
})
const integrationsLayoutRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/integrations",
  component: AdminLayout,
  notFoundComponent: RouterNotFoundComponent,
})
const integrationsRoute = createRoute({
  getParentRoute: () => integrationsLayoutRoute,
  path: "/$organizationId",
  component: IntegrationsRoute,
})
const membersLayoutRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/members",
  component: AdminLayout,
  notFoundComponent: RouterNotFoundComponent,
})
const membersRoute = createRoute({
  getParentRoute: () => membersLayoutRoute,
  path: "/$organizationId",
  validateSearch: memberDirectorySearchSchema,
  component: MembersRoute,
})
const organizationSettingsLayoutRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/organizations",
  component: AdminLayout,
  notFoundComponent: RouterNotFoundComponent,
})
const rolesRoute = createRoute({
  getParentRoute: () => organizationSettingsLayoutRoute,
  path: "/$organizationId/roles",
  validateSearch: OrganizationRoleDirectoryQuerySchema,
  component: RolesRoute,
})
const organizationSettingsRoute = createRoute({
  getParentRoute: () => organizationSettingsLayoutRoute,
  path: "/$organizationId/settings",
  component: OrganizationLocaleSettingsPage,
})
const personalSettingsLayoutRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: AdminLayout,
  notFoundComponent: RouterNotFoundComponent,
})
const personalSettingsRoute = createRoute({
  getParentRoute: () => personalSettingsLayoutRoute,
  path: "/preferences",
  component: PersonalLocaleSettingsRoute,
})
const personalLoginEventsRoute = createRoute({
  getParentRoute: () => personalSettingsLayoutRoute,
  path: "/login-events",
  validateSearch: (search) => PersonalLoginLogsQuerySchema.parse(search),
  component: PersonalLoginEventsRoute,
})
const auditEventsRoute = createRoute({
  getParentRoute: () => organizationSettingsLayoutRoute,
  path: "/$organizationId/audit",
  validateSearch: (search: Record<string, unknown>) =>
    AuditEventsQuerySchema.parse(search),
  component: AuditEventsRoute,
})

const announcementsLayoutRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/announcements",
  component: AdminLayout,
  notFoundComponent: RouterNotFoundComponent,
})
const announcementsRoute = createRoute({
  getParentRoute: () => announcementsLayoutRoute,
  path: "/$organizationId",
  validateSearch: (search) => AnnouncementInboxQuerySchema.parse(search),
  component: TenantAnnouncementInboxRoute,
})
const announcementReadRoute = createRoute({
  getParentRoute: () => announcementsLayoutRoute,
  path: "/$organizationId/$announcementId",
  component: TenantAnnouncementReadRoute,
})
export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    loginRoute,
    addAccountRoute,
    mfaRoute,
    forgotPasswordRoute,
    resetPasswordRoute,
    emailVerifiedRoute,
    acceptInvitationRoute,
    appRoute.addChildren([
      appIndexRoute,
      organizationRoute,
      projectsLayoutRoute.addChildren([projectsRoute, projectDetailRoute]),
      filesLayoutRoute.addChildren([filesRoute, fileDetailRoute]),
      membersLayoutRoute.addChildren([membersRoute]),
      integrationsLayoutRoute.addChildren([integrationsRoute]),
      tasksLayoutRoute.addChildren([tasksRoute]),
      announcementsLayoutRoute.addChildren([
        announcementsRoute,
        announcementReadRoute,
      ]),
      notificationsLayoutRoute.addChildren([notificationsRoute]),
      organizationSettingsLayoutRoute.addChildren([
        rolesRoute,
        organizationSettingsRoute,
        auditEventsRoute,
      ]),
      personalSettingsLayoutRoute.addChildren([
        personalSettingsRoute,
        personalLoginEventsRoute,
      ]),
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
