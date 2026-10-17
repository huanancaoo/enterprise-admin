import { useState } from "react"
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router"
import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import {
  platformOrganizationActor,
  platformEmployeeFixture,
  platformRoleFixture,
} from "@workspace/mocks"
import {
  PlatformEmployeesQuerySchema,
  PlatformSystemQuerySchema,
  PlatformRoleEmployeesQuerySchema,
} from "@workspace/contracts/platform-system"
import {
  PlatformEmployeesPage,
  PlatformEmployeeCreatePage,
  PlatformEmployeeGrantPage,
  PlatformEmployeeDetailPage,
} from "./employees"
import {
  PlatformRolesPage,
  PlatformRolePermissionsPage,
  PlatformRoleEmployeesPage,
} from "./roles"
import { authClient } from "../../lib/auth-client"

export type EmployeeRoleStoryPage =
  | "employees"
  | "employee-create"
  | "employee-grant"
  | "employee-detail"
  | "roles"
  | "role-permissions"
  | "role-employees"
const permissions = [
  "platform.authorization:manage",
  "platform.employee:read",
  "platform.employee:update",
  "platform.role:read",
  "platform.role:create",
  "platform.role:update",
  "platform.role:delete",
  "platform.user:resetPassword",
  "platform.user:unlock",
]

export function EmployeeRoleStory({
  page = "employees",
  readOnly = false,
  employeeAccess,
}: {
  page?: EmployeeRoleStoryPage
  readOnly?: boolean
  employeeAccess?: "read" | "update"
}) {
  const [router] = useState(() => {
    const root = createRootRoute({
      beforeLoad: () => ({ user: platformOrganizationActor }),
    })
    const platform = createRoute({
      getParentRoute: () => root,
      path: "platform",
      beforeLoad: () => ({
        platformAccess: {
          userId: platformOrganizationActor.id,
          roles: [
            {
              id: platformRoleFixture.id,
              key: readOnly || employeeAccess ? "reader" : "platform_admin",
              name: "Platform operator",
              builtIn: !readOnly && !employeeAccess,
            },
          ],
          permissions: employeeAccess
            ? [
                "platform.employee:read",
                ...(employeeAccess === "update"
                  ? ["platform.employee:update"]
                  : []),
              ]
            : readOnly
              ? ["platform.employee:read", "platform.role:read"]
              : permissions,
          scope: "global",
          mfaVerifiedAt: null,
        },
      }),
      component: () => (
        <main className="mx-auto max-w-6xl p-6">
          <Outlet />
        </main>
      ),
    })
    const routes = [
      createRoute({
        getParentRoute: () => platform,
        path: "employees",
        validateSearch: (search) => PlatformEmployeesQuerySchema.parse(search),
        component: PlatformEmployeesPage,
      }),
      createRoute({
        getParentRoute: () => platform,
        path: "employees/new",
        component: PlatformEmployeeCreatePage,
      }),
      createRoute({
        getParentRoute: () => platform,
        path: "employees/grant",
        component: PlatformEmployeeGrantPage,
      }),
      createRoute({
        getParentRoute: () => platform,
        path: "employees/$employeeId",
        component: PlatformEmployeeDetailPage,
      }),
      createRoute({
        getParentRoute: () => platform,
        path: "roles",
        validateSearch: (search) => PlatformSystemQuerySchema.parse(search),
        component: PlatformRolesPage,
      }),
      createRoute({
        getParentRoute: () => platform,
        path: "roles/$roleId/permissions",
        component: PlatformRolePermissionsPage,
      }),
      createRoute({
        getParentRoute: () => platform,
        path: "roles/$roleId/employees",
        validateSearch: (search) =>
          PlatformRoleEmployeesQuerySchema.parse({
            ...search,
            assigned: String(search.assigned ?? true),
          }),
        component: PlatformRoleEmployeesPage,
      }),
    ]
    const entries: Record<EmployeeRoleStoryPage, string> = {
      employees: "/platform/employees",
      "employee-create": "/platform/employees/new",
      "employee-grant": "/platform/employees/grant",
      "employee-detail": `/platform/employees/${platformEmployeeFixture.userId}`,
      roles: "/platform/roles",
      "role-permissions": `/platform/roles/${platformRoleFixture.id}/permissions`,
      "role-employees": `/platform/roles/${platformRoleFixture.id}/employees?assigned=true`,
    }
    return createRouter({
      routeTree: root.addChildren([platform.addChildren(routes)]),
      history: createMemoryHistory({ initialEntries: [entries[page]] }),
    })
  })
  return (
    <AuthenticatedSessionProvider
      client={authClient}
      user={platformOrganizationActor}
    >
      <RouterProvider router={router} />
    </AuthenticatedSessionProvider>
  )
}
