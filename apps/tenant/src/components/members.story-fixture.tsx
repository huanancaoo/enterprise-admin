import { useState } from "react"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import { memberDirectoryUser, organizations } from "@workspace/mocks"
import { authClient } from "../lib/auth-client"
import { memberDirectorySearchSchema } from "../query/organization-directory"
import { MembersRoute } from "./members-route"

export function MembersStory({ search = "" }: { search?: string }) {
  const [router] = useState(() => {
    const root = createRootRoute({
      component: () => (
        <main className="mx-auto max-w-6xl p-6">
          <Outlet />
        </main>
      ),
    })
    const members = createRoute({
      getParentRoute: () => root,
      path: "/app/members/$organizationId",
      validateSearch: (value) => memberDirectorySearchSchema.parse(value),
      component: MembersRoute,
    })
    return createRouter({
      routeTree: root.addChildren([members]),
      history: createMemoryHistory({
        initialEntries: [`/app/members/${organizations[0].id}${search}`],
      }),
    })
  })
  // 成员与内嵌邀请目录运行正式组件；登录、跨组织和退出后的导航另走真实浏览器。
  return (
    <AuthenticatedSessionProvider
      client={authClient}
      user={memberDirectoryUser}
    >
      <RouterProvider router={router} />
    </AuthenticatedSessionProvider>
  )
}
