import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router"
import { App, PlatformHome, PlatformLayout } from "./App"

const rootRoute = createRootRoute({ component: App })
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
})
const platformRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/platform",
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
    throw redirect({ to: "/platform/" })
  },
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    loginRoute,
    platformRoute.addChildren([platformIndexRoute]),
  ]),
})
