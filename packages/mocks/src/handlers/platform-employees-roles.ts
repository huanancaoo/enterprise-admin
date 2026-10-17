import { delay, http, HttpResponse } from "msw"
import {
  CreatePlatformEmployeeSchema,
  CreatePlatformRoleSchema,
  SetPlatformEmployeeRolesSchema,
  SetPlatformEmployeeStatusSchema,
  UpdatePlatformEmployeeSchema,
  PlatformEmployeeOptionsQuerySchema,
  type PlatformEmployee,
  type PlatformRole,
} from "@workspace/contracts/platform-system"

const employeeId = "c7dd0a27-4f8a-4aef-8d4c-000000008001"
const departmentId = "c7dd0a27-4f8a-4aef-8d4c-000000008101"
const postId = "c7dd0a27-4f8a-4aef-8d4c-000000008201"
const roleId = "c7dd0a27-4f8a-4aef-8d4c-000000008301"
const timestamp = "2026-10-17T00:00:00.000Z"
export const platformEmployeeFixture: PlatformEmployee = {
  userId: employeeId,
  name: "Mina Chen",
  maskedEmail: "m***@example.test",
  status: "active",
  departmentId,
  postIds: [postId],
  roleIds: [roleId],
  department: { id: departmentId, name: "Operations" },
  posts: [{ id: postId, name: "Support specialist" }],
  roles: [{ id: roleId, key: "support", name: "Support", builtIn: false }],
  version: 1,
  createdAt: timestamp,
  lockedUntil: null,
  failedAttempts: 0,
}
export const platformRoleFixture: PlatformRole = {
  id: roleId,
  key: "support",
  name: "Support",
  status: "active",
  sort: 10,
  builtIn: false,
  permissions: ["platform.employee:read", "platform.organization:read"],
  createdAt: timestamp,
  updatedAt: timestamp,
}
export type PlatformEmployeesRolesScenario =
  | "success"
  | "empty"
  | "loading"
  | "unavailable"
  | "locked"
  | "mutationFailure"
  | "withoutCatalogRead"

export function createPlatformEmployeesRolesScenario(
  scenario: PlatformEmployeesRolesScenario = "success"
) {
  let employees: PlatformEmployee[] = []
  let roles: PlatformRole[] = []
  const requests: { method: string; path: string }[] = []
  function reset() {
    employees =
      scenario === "empty"
        ? []
        : Array.from({ length: 25 }, (_, index) => ({
            ...structuredClone(platformEmployeeFixture),
            userId:
              index === 0
                ? employeeId
                : `c7dd0a27-4f8a-4aef-8d4c-${String(index + 8001).padStart(12, "0")}`,
            name: index === 0 ? "Mina Chen" : `Operator ${index + 1}`,
            roleIds: index % 2 === 0 ? [roleId] : [],
            roles:
              index % 2 === 0
                ? structuredClone(platformEmployeeFixture.roles)
                : [],
            lockedUntil:
              scenario === "locked" ? "2026-10-17T00:15:00.000Z" : null,
            failedAttempts: scenario === "locked" ? 5 : 0,
          }))
    roles = scenario === "empty" ? [] : [structuredClone(platformRoleFixture)]
    requests.splice(0)
  }
  reset()
  const error = () =>
    HttpResponse.json(
      {
        code: "SERVICE_UNAVAILABLE",
        message: "SERVICE_UNAVAILABLE",
        locale: "en-US",
        requestId: "storybook-system",
      },
      { status: 503 }
    )
  async function readFailure() {
    if (scenario === "loading") await delay("infinite")
    if (scenario === "unavailable") return error()
  }
  const page = <T>(rows: T[], url: URL) => {
    const number = Number(url.searchParams.get("page") ?? 1)
    const pageSize = Number(url.searchParams.get("pageSize") ?? 20)
    return {
      items: rows.slice((number - 1) * pageSize, number * pageSize),
      page: number,
      pageSize,
      total: rows.length,
    }
  }
  const projectEmployee = (employee: PlatformEmployee): PlatformEmployee => ({
    ...employee,
    department: employee.departmentId
      ? { id: employee.departmentId, name: "Operations" }
      : null,
    posts: employee.postIds.map((id) => ({ id, name: "Support specialist" })),
    roles: employee.roleIds.map((id) => {
      const role = roles.find((item) => item.id === id)!
      return { id, key: role.key, name: role.name, builtIn: role.builtIn }
    }),
  })
  const record = (request: Request) =>
    requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
    })
  return {
    reset,
    requests,
    handlers: [
      ...(scenario === "withoutCatalogRead"
        ? [
            http.get(
              /\/api\/v1\/platform\/(?:departments|posts|roles)(?:\/[^/?]+)?(?:\?.*)?$/,
              ({ request }) => {
                record(request)
                return HttpResponse.json(
                  {
                    code: "FORBIDDEN",
                    message: "FORBIDDEN",
                    locale: "en-US",
                    requestId: "storybook-system-catalog-denied",
                  },
                  { status: 403 }
                )
              }
            ),
          ]
        : []),
      ...(["department", "post", "role"] as const).map((kind) =>
        http.get(
          `*/api/v1/platform/employees/${kind}-options`,
          ({ request }) => {
            record(request)
            const url = new URL(request.url)
            const query = PlatformEmployeeOptionsQuerySchema.parse(
              Object.fromEntries(url.searchParams)
            )
            const options =
              kind === "department"
                ? [
                    {
                      id: departmentId,
                      key: "operations",
                      name: "Operations",
                      status: "active",
                      parentId: null,
                      hasChildren: false,
                    },
                    {
                      id: "c7dd0a27-4f8a-4aef-8d4c-000000008102",
                      key: "retired",
                      name: "Retired department",
                      status: "disabled",
                      parentId: null,
                      hasChildren: false,
                    },
                  ]
                : kind === "post"
                  ? [
                      {
                        id: postId,
                        key: "specialist",
                        name: "Support specialist",
                        status: "active",
                      },
                    ]
                  : roles.map((role) => ({
                      id: role.id,
                      key: role.key,
                      name: role.name,
                      status: role.status,
                    }))
            const ids = query.ids?.split(",")
            return HttpResponse.json(
              page(
                options.filter(
                  (option) =>
                    (!query.q ||
                      option.name
                        .toLowerCase()
                        .includes(query.q.toLowerCase()) ||
                      option.key
                        .toLowerCase()
                        .includes(query.q.toLowerCase())) &&
                    (!query.status || option.status === query.status) &&
                    (!ids || ids.includes(option.id))
                ),
                url
              )
            )
          }
        )
      ),

      http.get(
        "*/api/v1/platform/employees/candidates",
        async ({ request }) => {
          const failure = await readFailure()
          if (failure) return failure
          const candidate = {
            userId: "c7dd0a27-4f8a-4aef-8d4c-000000009001",
            name: "Jo Park",
            maskedEmail: "j***@example.test",
          }
          return HttpResponse.json(page([candidate], new URL(request.url)))
        }
      ),
      http.get("*/api/v1/platform/employees", async ({ request }) => {
        const failure = await readFailure()
        if (failure) return failure
        record(request)
        const url = new URL(request.url)
        const q = url.searchParams.get("q")?.toLowerCase() ?? ""
        const status = url.searchParams.get("status")
        return HttpResponse.json(
          page(
            employees
              .map(projectEmployee)
              .filter(
                (employee) =>
                  (!q ||
                    employee.name.toLowerCase().includes(q) ||
                    employee.maskedEmail.includes(q)) &&
                  (!status || employee.status === status)
              ),
            url
          )
        )
      }),
      http.post("*/api/v1/platform/employees", async ({ request }) => {
        record(request)
        if (scenario === "mutationFailure") return error()
        const value = CreatePlatformEmployeeSchema.parse(await request.json())
        const employee = {
          ...structuredClone(platformEmployeeFixture),
          userId:
            value.mode === "create"
              ? "c7dd0a27-4f8a-4aef-8d4c-000000009002"
              : value.userId,
          name: value.mode === "create" ? value.name : "Jo Park",
          departmentId: value.departmentId ?? null,
          postIds: value.postIds ?? [],
          roleIds: value.roleIds ?? [],
        }
        employees.push(employee)
        return HttpResponse.json(projectEmployee(employee), { status: 201 })
      }),
      http.post(
        "*/api/v1/platform/employees/batch-remove",
        async ({ request }) => {
          record(request)
          if (scenario === "mutationFailure") return error()
          const { userIds } = (await request.json()) as { userIds: string[] }
          employees = employees.filter(
            (employee) => !userIds.includes(employee.userId)
          )
          return HttpResponse.json({ userIds, deleted: true })
        }
      ),
      http.get("*/api/v1/platform/employees/:userId", async ({ params }) => {
        const failure = await readFailure()
        if (failure) return failure
        return HttpResponse.json(
          projectEmployee(
            employees.find((employee) => employee.userId === params.userId)!
          )
        )
      }),
      http.patch(
        "*/api/v1/platform/employees/:userId",
        async ({ params, request }) => {
          record(request)
          if (scenario === "mutationFailure") return error()
          const value = UpdatePlatformEmployeeSchema.parse(await request.json())
          const employee = employees.find(
            (employee) => employee.userId === params.userId
          )!
          Object.assign(employee, {
            name: value.name,
            departmentId: value.departmentId,
            postIds: value.postIds,
            version: employee.version + 1,
          })
          return HttpResponse.json(projectEmployee(employee))
        }
      ),
      http.patch(
        "*/api/v1/platform/employees/:userId/status",
        async ({ params, request }) => {
          record(request)
          if (scenario === "mutationFailure") return error()
          const value = SetPlatformEmployeeStatusSchema.parse(
            await request.json()
          )
          const employee = employees.find(
            (employee) => employee.userId === params.userId
          )!
          Object.assign(employee, {
            status: value.status,
            roleIds: value.status === "disabled" ? [] : employee.roleIds,
            version: employee.version + 1,
          })
          return HttpResponse.json(projectEmployee(employee))
        }
      ),
      http.patch(
        "*/api/v1/platform/employees/:userId/roles",
        async ({ params, request }) => {
          record(request)
          if (scenario === "mutationFailure") return error()
          const value = SetPlatformEmployeeRolesSchema.parse(
            await request.json()
          )
          const employee = employees.find(
            (employee) => employee.userId === params.userId
          )!
          Object.assign(employee, {
            roleIds: value.roleIds,
            version: employee.version + 1,
          })
          return HttpResponse.json(projectEmployee(employee))
        }
      ),
      http.delete(
        "*/api/v1/platform/employees/:userId",
        ({ params, request }) => {
          record(request)
          if (scenario === "mutationFailure") return error()
          employees = employees.filter(
            (employee) => employee.userId !== params.userId
          )
          return HttpResponse.json({ id: params.userId, deleted: true })
        }
      ),
      http.post("*/api/v1/platform/users/:userId/password-reset", () =>
        HttpResponse.json({ accepted: true })
      ),
      http.post(
        "*/api/v1/platform/users/:userId/password-login/unlock",
        ({ params, request }) => {
          record(request)
          if (scenario === "mutationFailure") return error()
          const employee = employees.find(
            (employee) => employee.userId === params.userId
          )!
          employee.lockedUntil = null
          employee.failedAttempts = 0
          return HttpResponse.json({ unlocked: true })
        }
      ),
      http.get("*/api/v1/platform/departments", ({ request }) => {
        const department = {
          id: departmentId,
          key: "operations",
          name: "Operations",
          status: "active",
          sort: 1,
          parentId: null,
          hasChildren: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        const url = new URL(request.url)
        return HttpResponse.json({
          items: url.searchParams.has("parentId") ? [] : [department],
          ancestors: url.searchParams.has("parentId") ? [department] : [],
        })
      }),
      http.get("*/api/v1/platform/departments/:id", ({ params }) =>
        HttpResponse.json({
          id: params.id,
          key: "operations",
          name: "Operations",
          status: "active",
          sort: 1,
          parentId: null,
          hasChildren: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      ),
      http.get("*/api/v1/platform/posts", ({ request }) =>
        HttpResponse.json(
          page(
            [
              {
                id: postId,
                key: "specialist",
                name: "Support specialist",
                status: "active",
                sort: 1,
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            ],
            new URL(request.url)
          )
        )
      ),
      http.get("*/api/v1/platform/posts/:id", ({ params }) =>
        HttpResponse.json({
          id: params.id,
          key: "specialist",
          name: "Support specialist",
          status: "active",
          sort: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      ),
      http.get("*/api/v1/platform/menus/registry", () =>
        HttpResponse.json({
          pages: [{ key: "employees", path: "/platform/employees" }],
          actions: [
            "platform.employee:read",
            "platform.employee:update",
            "platform.organization:read",
            "platform.user:unlock",
          ].map((key) => ({ key })),
        })
      ),
      http.get("*/api/v1/platform/roles", async ({ request }) => {
        const failure = await readFailure()
        if (failure) return failure
        const url = new URL(request.url)
        const q = url.searchParams.get("q")?.toLowerCase() ?? ""
        const status = url.searchParams.get("status")
        return HttpResponse.json(
          page(
            roles.filter(
              (role) =>
                (!q ||
                  role.name.toLowerCase().includes(q) ||
                  role.key.includes(q)) &&
                (!status || role.status === status)
            ),
            url
          )
        )
      }),
      http.post("*/api/v1/platform/roles", async ({ request }) => {
        record(request)
        if (scenario === "mutationFailure") return error()
        const value = CreatePlatformRoleSchema.parse(await request.json())
        const role = {
          ...structuredClone(platformRoleFixture),
          ...value,
          id: "c7dd0a27-4f8a-4aef-8d4c-000000009301",
          permissions: [],
        }
        roles.push(role)
        return HttpResponse.json(role, { status: 201 })
      }),
      http.get("*/api/v1/platform/roles/:roleId", async ({ params }) => {
        const failure = await readFailure()
        if (failure) return failure
        return HttpResponse.json(
          roles.find((role) => role.id === params.roleId)
        )
      }),
      http.patch(
        "*/api/v1/platform/roles/:roleId",
        async ({ params, request }) => {
          record(request)
          if (scenario === "mutationFailure") return error()
          const value = CreatePlatformRoleSchema.parse(await request.json())
          const role = roles.find((role) => role.id === params.roleId)!
          Object.assign(role, value, { updatedAt: new Date().toISOString() })
          return HttpResponse.json(role)
        }
      ),
      http.patch(
        "*/api/v1/platform/roles/:roleId/status",
        async ({ params, request }) => {
          record(request)
          if (scenario === "mutationFailure") return error()
          const value = (await request.json()) as {
            status: "active" | "disabled"
          }
          const role = roles.find((role) => role.id === params.roleId)!
          role.status = value.status
          return HttpResponse.json(role)
        }
      ),
      http.patch(
        "*/api/v1/platform/roles/:roleId/permissions",
        async ({ params, request }) => {
          record(request)
          if (scenario === "mutationFailure") return error()
          const value = (await request.json()) as { permissions: string[] }
          const role = roles.find((role) => role.id === params.roleId)!
          role.permissions = value.permissions
          return HttpResponse.json(role)
        }
      ),
      http.delete("*/api/v1/platform/roles/:roleId", ({ params, request }) => {
        record(request)
        if (scenario === "mutationFailure") return error()
        roles = roles.filter((role) => role.id !== params.roleId)
        for (const employee of employees)
          employee.roleIds = employee.roleIds.filter(
            (id) => id !== params.roleId
          )
        return HttpResponse.json({ id: params.roleId, deleted: true })
      }),
      http.get(
        "*/api/v1/platform/roles/:roleId/employees",
        async ({ params, request }) => {
          const failure = await readFailure()
          if (failure) return failure
          const url = new URL(request.url)
          const assigned = url.searchParams.get("assigned") === "true"
          const q = url.searchParams.get("q")?.toLowerCase() ?? ""
          return HttpResponse.json(
            page(
              employees
                .map(projectEmployee)
                .filter(
                  (employee) =>
                    employee.roleIds.includes(String(params.roleId)) ===
                      assigned &&
                    (!q || employee.name.toLowerCase().includes(q))
                ),
              url
            )
          )
        }
      ),
      ...(["post", "delete"] as const).map((method) =>
        http[method](
          "*/api/v1/platform/roles/:roleId/employees",
          async ({ params, request }) => {
            record(request)
            if (scenario === "mutationFailure") return error()
            const { userIds } = (await request.json()) as { userIds: string[] }
            const id = String(params.roleId)
            for (const employee of employees.filter((employee) =>
              userIds.includes(employee.userId)
            ))
              employee.roleIds =
                method === "post"
                  ? [...new Set([...employee.roleIds, id])]
                  : employee.roleIds.filter((role) => role !== id)
            return HttpResponse.json({
              roleId: id,
              userIds,
              assigned: method === "post",
            })
          }
        )
      ),
    ],
  }
}
