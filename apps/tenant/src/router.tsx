import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router"
import { ProjectListQuerySchema } from "@workspace/contracts"
import {
  LoadingState,
  NotFoundState,
  RouterErrorComponent,
} from "@workspace/admin"
import { ForgotPasswordPage } from "@workspace/admin/auth"
import type { WorkspaceRouterContext } from "@workspace/admin/auth"
import {
  getProjectDetailOptions,
  getProjectsListOptions,
  getWorkspaceOrganizationsOptions,
} from "@workspace/api-client"
import {
  App,
  TenantAcceptInvitationPage,
  TenantEmailVerifiedPage,
  TenantLoginPage,
  TenantResetPasswordPage,
  TenantAuthTitlePage,
} from "./App"
import { ProjectsRoute } from "./components/projects-route"
import { ProjectDetailRoute } from "./components/project-detail-route"
import { AdminLayout } from "./components/admin-layout"
import { MembersRoute } from "./components/members-route"
import { getOrganizationDirectoryOptions } from "./query/organization-directory"
import { OrganizationGate } from "./components/organization-workspace"

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
// 布局在子 loader 完成前就会挂载并订阅 access；access 不能放进子 loader 的 query()，否则 StrictMode 卸观察者会取消 fetch，列表变成 CatchBoundary。
const projectsLayoutRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects",
  component: AdminLayout,
})
const projectsRoute = createRoute({
  getParentRoute: () => projectsLayoutRoute,
  path: "/$organizationId",
  validateSearch: ProjectListQuerySchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) =>
    context.queryClient.query({
      ...getProjectsListOptions(params.organizationId, deps, context.locale),
      staleTime: "static",
    }),
  component: ProjectsRoute,
})
const projectDetailRoute = createRoute({
  getParentRoute: () => projectsLayoutRoute,
  path: "/$organizationId/$projectId",
  // 404/403 是详情页自己的页面态；query() 抛出后会进 CatchBoundary，而不是「未找到项目」。
  loader: ({ context, params }) =>
    context.queryClient
      .query({
        ...getProjectDetailOptions(
          params.organizationId,
          params.projectId,
          context.locale
        ),
        staleTime: "static",
      })
      .catch(() => undefined),
  component: ProjectDetailRoute,
})
const membersLayoutRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/members",
  component: AdminLayout,
})
const membersRoute = createRoute({
  getParentRoute: () => membersLayoutRoute,
  path: "/$organizationId",
  loader: ({ context, params }) =>
    context.queryClient.query({
      ...getOrganizationDirectoryOptions(params.organizationId),
      staleTime: "static",
    }),
  component: MembersRoute,
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
      membersLayoutRoute.addChildren([membersRoute]),
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
