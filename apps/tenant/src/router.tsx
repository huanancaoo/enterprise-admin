import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router"
import { ProjectListQuerySchema } from "@workspace/contracts"
import { ForgotPasswordPage } from "@workspace/admin/auth"
import {
  App,
  TenantAcceptInvitationPage,
  TenantAuthTitlePage,
  TenantEmailVerifiedPage,
  TenantResetPasswordPage,
} from "./App"
import { ProjectsRoute } from "./components/projects-route"
import { ProjectDetailRoute } from "./components/project-detail-route"
import { AdminLayout } from "./components/admin-layout"
import { MembersRoute } from "./components/members-route"
import {
  OrganizationGate,
  WorkspaceEntry,
} from "./components/organization-workspace"

const rootRoute = createRootRoute({ component: App })
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
  component: Outlet,
})
const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: WorkspaceEntry,
})
// 进入门不能套工作台：此时还没有租户可工作。
const organizationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/select-organization",
  component: OrganizationGate,
})
// 工作台挂在 /projects 下，进入门仍是 /app 的兄弟路由。不用 pathless id，以免改写 useParams 的 from。
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
const membersLayoutRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/members",
  component: AdminLayout,
})
const membersRoute = createRoute({
  getParentRoute: () => membersLayoutRoute,
  path: "/$organizationId",
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
})
