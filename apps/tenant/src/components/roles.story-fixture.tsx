import { useState } from "react"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { organizations } from "@workspace/mocks"
import { RolesRoute } from "./roles-route"

export function RolesStory() {
  const [router] = useState(() => {
    const root = createRootRoute({
      component: () => (
        <main className="mx-auto max-w-6xl p-6">
          <Outlet />
        </main>
      ),
    })
    const roles = createRoute({
      getParentRoute: () => root,
      path: "/app/organizations/$organizationId/roles",
      component: RolesRoute,
    })
    return createRouter({
      routeTree: root.addChildren([roles]),
      history: createMemoryHistory({
        initialEntries: [`/app/organizations/${organizations[0].id}/roles`],
      }),
    })
  })
  // 正式路由和原生客户端用于 UI 状态；身份、授权与持久化另走真实业务链路。
  return <RouterProvider router={router} />
}
