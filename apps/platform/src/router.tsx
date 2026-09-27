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
import { PlatformAccessSchema, type PlatformAccess } from "@workspace/contracts"
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
      if (error instanceof ApiClientError && error.status === 401) {
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
    platformRoute.addChildren([platformIndexRoute]),
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
