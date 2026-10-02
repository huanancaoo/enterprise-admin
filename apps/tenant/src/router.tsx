import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useParams,
} from "@tanstack/react-router"
import {
  AuditEventsQuerySchema,
  FileListQuerySchema,
  ProjectListQuerySchema,
} from "@workspace/contracts"
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
  TenantResetPasswordPage,
  TenantAuthTitlePage,
} from "./App"
import { ProjectsRoute } from "./components/projects-route"
import { FilesRoute } from "./features/files/files-route"
import { FileDetailRoute } from "./features/files/file-detail-route"
import { fileDetailSearchSchema } from "./features/files/file-detail-search"
import { ProjectDetailRoute } from "./components/project-detail-route"
import { AdminLayout } from "./components/admin-layout"
import { MembersRoute } from "./components/members-route"
import { RolesRoute } from "./components/roles-route"
import { AuditEventsRoute } from "./components/audit-events-route"
import { memberDirectorySearchSchema } from "./query/organization-directory"
import { OrganizationGate } from "./components/organization-workspace"
import {
  OrganizationLocaleSettingsRoute,
  PersonalLocaleSettingsRoute,
} from "./components/locale-settings"

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
  component: function OrganizationSettingsPage() {
    const { organizationId } = useParams({
      from: "/app/organizations/$organizationId/settings",
    })
    return <OrganizationLocaleSettingsRoute organizationId={organizationId} />
  },
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
  defaultNotFoundComponent: NotFoundState,
  defaultErrorComponent: RouterErrorComponent,
  defaultPendingComponent: LoadingState,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
