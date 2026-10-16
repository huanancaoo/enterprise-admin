import { taskCenterSearchSchema } from "./features/tasks/task-center-search"
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from "@tanstack/react-router"
import { AuditEventsQuerySchema } from "@workspace/contracts/audit"
import { CapabilityPageQuerySchema } from "@workspace/contracts/framework-capabilities"
import { FileListQuerySchema } from "@workspace/contracts/files"
import { ProjectListQuerySchema } from "@workspace/contracts/project-query"
import {
  LoadingState,
  NotFoundState,
  RouterErrorComponent,
} from "@workspace/admin"
import { ForgotPasswordPage } from "@workspace/admin/auth"
import type { WorkspaceRouterContext } from "@workspace/admin/auth"
import { getWorkspaceOrganizationsOptions } from "@workspace/api-client"
import {
  App,
  TenantAcceptInvitationPage,
  TenantEmailVerifiedPage,
  TenantLoginPage,
  TenantMfaPage,
  TenantResetPasswordPage,
  TenantAuthTitlePage,
} from "./App"
import { fileDetailSearchSchema } from "./features/files/file-detail-search"
import { memberDirectorySearchSchema } from "./query/organization-directory"

// 参数校验和权限钩子随路由注册；业务页面由 Router 按导航或预加载意图加载。
const NotificationsRoute = lazyRouteComponent(
  () => import("./features/notifications/notifications-route"),
  "NotificationsRoute"
)
const TasksRoute = lazyRouteComponent(
  () => import("./features/tasks/tasks-route"),
  "TasksRoute"
)
const ProjectsRoute = lazyRouteComponent(
  () => import("./components/projects-route"),
  "ProjectsRoute"
)
const IntegrationsRoute = lazyRouteComponent(
  () => import("./features/integrations/integrations-route"),
  "IntegrationsRoute"
)
const FilesRoute = lazyRouteComponent(
  () => import("./features/files/files-route"),
  "FilesRoute"
)
const FileDetailRoute = lazyRouteComponent(
  () => import("./features/files/file-detail-route"),
  "FileDetailRoute"
)
const ProjectDetailRoute = lazyRouteComponent(
  () => import("./components/project-detail-route"),
  "ProjectDetailRoute"
)
const AdminLayout = lazyRouteComponent(
  () => import("./components/admin-layout"),
  "AdminLayout"
)
const MembersRoute = lazyRouteComponent(
  () => import("./components/members-route"),
  "MembersRoute"
)
const RolesRoute = lazyRouteComponent(
  () => import("./components/roles-route"),
  "RolesRoute"
)
const AuditEventsRoute = lazyRouteComponent(
  () => import("./components/audit-events-route"),
  "AuditEventsRoute"
)
const OrganizationGate = lazyRouteComponent(
  () => import("./components/organization-workspace"),
  "OrganizationGate"
)
const PersonalLocaleSettingsRoute = lazyRouteComponent(
  () => import("./components/locale-settings"),
  "PersonalLocaleSettingsRoute"
)
const OrganizationLocaleSettingsPage = lazyRouteComponent(
  () => import("./components/locale-settings"),
  "OrganizationLocaleSettingsPage"
)

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
})
const rolesRoute = createRoute({
  getParentRoute: () => organizationSettingsLayoutRoute,
  path: "/$organizationId/roles",
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
})
const personalSettingsRoute = createRoute({
  getParentRoute: () => personalSettingsLayoutRoute,
  path: "/preferences",
  component: PersonalLocaleSettingsRoute,
})
const auditEventsRoute = createRoute({
  getParentRoute: () => organizationSettingsLayoutRoute,
  path: "/$organizationId/audit",
  validateSearch: (search: Record<string, unknown>) =>
    AuditEventsQuerySchema.parse(search),
  component: AuditEventsRoute,
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
      notificationsLayoutRoute.addChildren([notificationsRoute]),
      organizationSettingsLayoutRoute.addChildren([
        rolesRoute,
        organizationSettingsRoute,
        auditEventsRoute,
      ]),
      personalSettingsLayoutRoute.addChildren([personalSettingsRoute]),
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
