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
import {
  App,
  PlatformAuthTitlePage,
  PlatformEmailVerifiedPage,
  PlatformHome,
  PlatformLayout,
  PlatformLoginPage,
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
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: "/login" })
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
