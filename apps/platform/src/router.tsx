import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router"
import { App } from "./App"

const rootRoute = createRootRoute()
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: App,
})
const platformRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/platform/",
  component: App,
})
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/platform/" })
  },
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, loginRoute, platformRoute]),
})
