import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router"
import {
  LoadingState,
  NotFoundState,
  RouterErrorComponent,
} from "@workspace/admin"
import { ForgotPasswordPage } from "@workspace/admin/auth"
import type { WorkspaceRouterContext } from "@workspace/admin/auth"
import { ApiClientError, apiClient } from "@workspace/api-client"
import {
  PlatformAccessSchema,
  PlatformOrganizationQuerySchema,
  PlatformUsersQuerySchema,
  PlatformAuditQuerySchema,
  type PlatformAccess,
} from "@workspace/contracts"
import {
  PlatformOrganizationsPage,
  PlatformOrganizationDetailPage,
} from "./features/organizations/pages"
import {
  PlatformUsersPage,
  PlatformUserDetailPage,
} from "./features/users/pages"
import {
  App,
  PlatformAuthTitlePage,
  PlatformEmailVerifiedPage,
  PlatformHome,
  PlatformLayout,
  PlatformLoginPage,
  PlatformMfaPage,
  PlatformAccessDeniedPage,
  PlatformResetPasswordPage,
} from "./App"
import { authClient } from "./lib/auth-client"

import { PlatformSettingsPage } from "./features/settings-page"
import { PlatformPersonalSettingsPage } from "./features/personal-settings-page"
import { PlatformAuditPage } from "./features/audit/page"

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
    if (!context.user && !search.challenge) throw redirect({ to: "/login" })
  },
  component: PlatformMfaPage,
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
      if (
        error instanceof ApiClientError &&
        [401, 403].includes(error.status)
      ) {
        await context.queryClient.cancelQueries({
          queryKey: ["platform", context.user.id],
        })
        context.queryClient.removeQueries({
          queryKey: ["platform", context.user.id],
        })
      }
      if (error instanceof ApiClientError && error.status === 401) {
        authClient.$store.notify("$sessionSignal")
        throw redirect({ to: "/login" })
      }
      if (
        error instanceof ApiClientError &&
        error.body.code === "PLATFORM_MFA_REQUIRED"
      ) {
        throw redirect({ to: "/platform/mfa", search: { challenge: false } })
      }
      if (error instanceof ApiClientError && error.status === 403) {
        throw redirect({ to: "/platform/access-denied" })
      }
      throw error
    }
  },
  component: PlatformLayout,
})
const platformIndexRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "/",
  component: PlatformHome,
})
const platformOrganizationsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "organizations",
  validateSearch: (search) => PlatformOrganizationQuerySchema.parse(search),
  component: PlatformOrganizationsPage,
})
const platformOrganizationDetailRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "organizations/$organizationId",
  component: PlatformOrganizationDetailPage,
})
const platformUsersRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "users",
  validateSearch: (search) => PlatformUsersQuerySchema.parse(search),
  component: PlatformUsersPage,
})
const platformUserDetailRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "users/$userId",
  component: PlatformUserDetailPage,
})
const platformAuditRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "audit-events",
  validateSearch: (search) =>
    PlatformAuditQuerySchema.omit({ purpose: true, cursor: true }).parse(
      search
    ),
  component: PlatformAuditPage,
})
const personalSettingsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "personal-settings",
  component: PlatformPersonalSettingsPage,
})
const platformSettingsRoute = createRoute({
  getParentRoute: () => platformRoute,
  path: "settings",
  component: PlatformSettingsPage,
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
      platformSettingsRoute,
      personalSettingsRoute,
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
