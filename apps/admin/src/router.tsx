import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router"
import { ProjectListQuerySchema } from "@workspace/contracts"
import { App } from "./App"
import { ProjectsRoute } from "./components/projects-route"
import { ProjectDetailRoute } from "./components/project-detail-route"

const rootRoute = createRootRoute()
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: App,
})
const organizationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/select-organization",
  component: App,
})
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/app/select-organization" })
  },
})
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  beforeLoad: () => {
    throw redirect({ to: "/app/select-organization" })
  },
})
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/projects/$organizationId",
  validateSearch: ProjectListQuerySchema,
  component: ProjectsRoute,
})
const projectDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/projects/$organizationId/$projectId",
  component: ProjectDetailRoute,
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    appRoute,
    loginRoute,
    organizationRoute,
    projectsRoute,
    projectDetailRoute,
  ]),
})
