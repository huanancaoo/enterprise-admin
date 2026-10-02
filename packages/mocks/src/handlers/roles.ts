import { delay, http, HttpResponse } from "msw"
import { organizations } from "../fixtures/projects"

export type RolesScenario =
  | "success"
  | "accessLoading"
  | "accessUnavailable"
  | "accessForbidden"
  | "accessUnauthorized"
  | "permissionDenied"
  | "loading"
  | "empty"
  | "unavailable"
  | "slow"
  | "longText"
  | "readOnly"
  | "createOnly"
  | "updateOnly"
  | "deleteOnly"
  | "limitedDelegation"
  | "createLoading"
  | "createReadBackSlow"
  | "createUnavailable"
  | "createRateLimited"
  | "createForbidden"
  | "createUnauthorized"
  | "createDuplicate"
  | "createPermissionDenied"
  | "updateLoading"
  | "updateUnavailable"
  | "updateRateLimited"
  | "updateForbidden"
  | "updateUnauthorized"
  | "updatePermissionDenied"
  | "updateStale"
  | "deleteLoading"
  | "deleteUnavailable"
  | "deleteRateLimited"
  | "deleteForbidden"
  | "deleteUnauthorized"
  | "deleteStale"
  | "referenced"

type Role = {
  id: string
  organizationId: string
  role: string
  permission: Record<string, string[]>
  createdAt: string
  memberCount: number
  invitationCount: number
  authorizationVersion: number
}
export const longRoleKey = "collaboration-" + "a".repeat(34)

export function createRolesScenario(scenario: RolesScenario = "success") {
  const organizationId = organizations[0].id
  const base: Role[] = [
    {
      id: "c7dd0a27-4f8a-4aef-8d4c-000000008101",
      organizationId,
      role: scenario === "longText" ? longRoleKey : "project-editor",
      permission: { project: ["read", "update"] },
      createdAt: "2026-09-01T10:00:00.000Z",
      memberCount: scenario === "referenced" ? 3 : 0,
      invitationCount: scenario === "referenced" ? 2 : 0,
      authorizationVersion: 3,
    },
    {
      id: "c7dd0a27-4f8a-4aef-8d4c-000000008102",
      organizationId,
      role: "empty-role",
      permission: {},
      createdAt: "2026-09-01T11:00:00.000Z",
      memberCount: 0,
      invitationCount: 0,
      authorizationVersion: 3,
    },
  ]
  let rows = structuredClone(scenario === "empty" ? [] : base)
  let version = 3
  let wrote = false
  let failedOnce = false
  let accessFailedOnce = false
  const failure = (status: number, code: string, message: string) =>
    HttpResponse.json(
      { code, message, locale: "en-US", requestId: "roles-story-request" },
      { status }
    )
  const permissions = [
    { resource: "project", action: "read" },
    { resource: "project", action: "update" },
    { resource: "member", action: "read" },
    { resource: "invitation", action: "create" },
    { resource: "audit", action: "read" },
  ]
  const writeFailure = async (
    kind: "create" | "update" | "delete",
    request: Request
  ) => {
    if (scenario === `${kind}Loading`) await delay("infinite")
    if (scenario === `${kind}Forbidden`)
      return failure(403, "FORBIDDEN", "Role permission denied")
    if (scenario === `${kind}Unauthorized`)
      return failure(401, "UNAUTHENTICATED", "Authentication required")
    if (scenario === `${kind}PermissionDenied`)
      return failure(400, "ROLE_PERMISSION_NOT_DELEGABLE", "Not delegable")
    if (scenario === "createDuplicate" && kind === "create")
      return failure(409, "ROLE_NAME_IS_ALREADY_TAKEN", "Duplicate role key")
    if (!failedOnce && scenario === `${kind}Stale`) {
      failedOnce = true
      version += 1
      for (const row of rows) {
        row.authorizationVersion = version
        row.memberCount = 2
        row.invitationCount = 1
      }
      return failure(409, "AUTHORIZATION_VERSION_CONFLICT", "Version changed")
    }
    if (
      !failedOnce &&
      (scenario === `${kind}Unavailable` || scenario === `${kind}RateLimited`)
    ) {
      failedOnce = true
      return failure(
        scenario === `${kind}RateLimited` ? 429 : 503,
        scenario === `${kind}RateLimited` ? "RATE_LIMITED" : "INTERNAL_ERROR",
        "Role request unavailable"
      )
    }
    if (
      kind !== "create" &&
      request.headers.get("X-Expected-Authz-Version") !== String(version)
    )
      return failure(409, "AUTHORIZATION_VERSION_CONFLICT", "Version changed")
    if (kind === "delete") {
      const input = (await request.clone().json()) as { roleId: string }
      const row = rows.find((role) => role.id === input.roleId)!
      // 重新复核只更新授权版本，已有成员和有效邀请引用仍然阻止删除。
      if (row.memberCount > 0 || row.invitationCount > 0)
        return HttpResponse.json(
          {
            code: "ROLE_IN_USE",
            message: "Role is referenced",
            memberCount: row.memberCount,
            invitationCount: row.invitationCount,
          },
          { status: 409 }
        )
    }
    await delay(300)
    return null
  }
  return {
    reset: () => {
      rows = structuredClone(scenario === "empty" ? [] : base)
      version = 3
      wrote = false
      failedOnce = false
      accessFailedOnce = false
    },
    handlers: [
      http.get(
        "*/api/v1/organizations/:organizationId/role-access",
        async () => {
          if (scenario === "accessLoading") await delay("infinite")
          if (scenario === "accessUnavailable" && !accessFailedOnce) {
            accessFailedOnce = true
            return failure(
              503,
              "AUTHORIZATION_UNAVAILABLE",
              "Access unavailable"
            )
          }
          if (scenario === "accessForbidden")
            return failure(403, "FORBIDDEN", "Access denied")
          if (scenario === "accessUnauthorized")
            return failure(401, "UNAUTHENTICATED", "Authentication required")
          if (scenario === "createReadBackSlow" && wrote) await delay(700)
          return HttpResponse.json({
            canRead: scenario !== "permissionDenied",
            canCreate: !["readOnly", "updateOnly", "deleteOnly"].includes(
              scenario
            ),
            canUpdate: !["readOnly", "createOnly", "deleteOnly"].includes(
              scenario
            ),
            canDelete: !["readOnly", "createOnly", "updateOnly"].includes(
              scenario
            ),
            grantablePermissions:
              scenario === "limitedDelegation"
                ? permissions.filter((item) => item.action !== "update")
                : permissions,
          })
        }
      ),
      http.get("*/api/auth/organization/list-roles", async ({ request }) => {
        if (
          new URL(request.url).searchParams.get("organizationId") !==
          organizationId
        )
          return failure(403, "FORBIDDEN", "Access denied")
        if (scenario === "loading") await delay("infinite")
        if (scenario === "unavailable")
          return failure(503, "INTERNAL_ERROR", "Role directory unavailable")
        if (scenario === "slow" || (scenario === "createReadBackSlow" && wrote))
          await delay(700)
        return HttpResponse.json(rows)
      }),
      http.post("*/api/auth/organization/create-role", async ({ request }) => {
        const rejected = await writeFailure("create", request)
        if (rejected) return rejected
        const input = (await request.json()) as {
          organizationId: string
          role: string
          permission: Record<string, string[]>
        }
        const row: Role = {
          id: "c7dd0a27-4f8a-4aef-8d4c-000000008199",
          organizationId,
          role: input.role,
          permission: input.permission,
          createdAt: new Date().toISOString(),
          memberCount: 0,
          invitationCount: 0,
          authorizationVersion: ++version,
        }
        rows.push(row)
        for (const role of rows) role.authorizationVersion = version
        wrote = true
        return HttpResponse.json({ success: true, roleData: row })
      }),
      http.post("*/api/auth/organization/update-role", async ({ request }) => {
        const rejected = await writeFailure("update", request)
        if (rejected) return rejected
        const input = (await request.json()) as {
          roleId: string
          data: { permission: Record<string, string[]> }
        }
        const row = rows.find((role) => role.id === input.roleId)!
        row.permission = input.data.permission
        version += 1
        for (const role of rows) role.authorizationVersion = version
        return HttpResponse.json({ success: true, roleData: row })
      }),
      http.post("*/api/auth/organization/delete-role", async ({ request }) => {
        const rejected = await writeFailure("delete", request)
        if (rejected) return rejected
        const input = (await request.json()) as { roleId: string }
        rows = rows.filter((role) => role.id !== input.roleId)
        version += 1
        for (const role of rows) role.authorizationVersion = version
        return HttpResponse.json({ success: true })
      }),
    ],
  }
}
