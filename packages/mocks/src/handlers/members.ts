import { delay, http, HttpResponse } from "msw"
import { organizations } from "../fixtures/projects"

export const memberDirectoryUser = {
  id: "c7dd0a27-4f8a-4aef-8d4c-000000006001",
  name: "Morgan Owner",
  email: "morgan@example.test",
}
type Member = {
  id: string
  organizationId: string
  userId: string
  role: string
  createdAt: string
  user: typeof memberDirectoryUser
}
export type MembersScenario =
  | "success"
  | "loading"
  | "empty"
  | "unavailable"
  | "forbidden"
  | "unauthorized"
  | "longText"
  | "slow"
  | "paginated"
  | "admin"
  | "member"
  | "delegated"
  | "updateOnly"
  | "deleteOnly"
  | "permissionUnavailable"
  | "accessUnavailable"
  | "saveLoading"
  | "saveUnavailable"
  | "rateLimited"
  | "stale"
  | "saveForbidden"
  | "saveUnauthorized"
  | "lastOwner"
  | "rolesLoading"
  | "rolesUnavailable"

export function createMembersScenario(scenario: MembersScenario = "success") {
  const organizationId = organizations[0].id
  const actorRole =
    scenario === "admin"
      ? "admin"
      : scenario === "member"
        ? "member"
        : ["delegated", "updateOnly", "deleteOnly"].includes(scenario)
          ? "team-manager"
          : "owner"
  const base: Member[] = [
    {
      id: "c7dd0a27-4f8a-4aef-8d4c-000000006101",
      organizationId,
      userId: memberDirectoryUser.id,
      role: actorRole,
      createdAt: "2026-09-04T00:00:00.000Z",
      user: memberDirectoryUser,
    },
    {
      id: "c7dd0a27-4f8a-4aef-8d4c-000000006102",
      organizationId,
      userId: "c7dd0a27-4f8a-4aef-8d4c-000000006002",
      role: "admin",
      createdAt: "2026-09-03T00:00:00.000Z",
      user: {
        id: "c7dd0a27-4f8a-4aef-8d4c-000000006002",
        name: "Blair Admin",
        email: "blair@example.test",
      },
    },
    {
      id: "c7dd0a27-4f8a-4aef-8d4c-000000006103",
      organizationId,
      userId: "c7dd0a27-4f8a-4aef-8d4c-000000006003",
      role: "member",
      createdAt: "2026-09-02T00:00:00.000Z",
      user: {
        id: "c7dd0a27-4f8a-4aef-8d4c-000000006003",
        name:
          scenario === "longText"
            ? "international-collaboration-member-".repeat(5)
            : "Casey Reader",
        email: "casey@example.test",
      },
    },
    {
      id: "c7dd0a27-4f8a-4aef-8d4c-000000006104",
      organizationId,
      userId: "c7dd0a27-4f8a-4aef-8d4c-000000006004",
      role: "project-editor",
      createdAt: "2026-09-01T00:00:00.000Z",
      user: {
        id: "c7dd0a27-4f8a-4aef-8d4c-000000006004",
        name: "Devon Editor",
        email: "devon@example.test",
      },
    },
  ]
  if (actorRole !== "owner")
    base.push({
      id: "c7dd0a27-4f8a-4aef-8d4c-000000006105",
      organizationId,
      userId: "c7dd0a27-4f8a-4aef-8d4c-000000006005",
      role: "owner",
      createdAt: "2026-08-31T00:00:00.000Z",
      user: {
        id: "c7dd0a27-4f8a-4aef-8d4c-000000006005",
        name: "Owen Owner",
        email: "owen@example.test",
      },
    })
  if (scenario === "paginated")
    for (let i = 5; i <= 25; i++)
      base.push({
        id: `c7dd0a27-4f8a-4aef-8d4c-${String(6100 + i).padStart(12, "0")}`,
        organizationId,
        userId: `c7dd0a27-4f8a-4aef-8d4c-${String(6000 + i).padStart(12, "0")}`,
        role: "member",
        createdAt: new Date(Date.UTC(2026, 8, i)).toISOString(),
        user: {
          id: `c7dd0a27-4f8a-4aef-8d4c-${String(6000 + i).padStart(12, "0")}`,
          name: `Directory member ${i}`,
          email: `member-${i}@example.test`,
        },
      })
  let members = structuredClone(base)
  let version = 3
  let rejectedOnce = false
  let revoked = false
  const failure = (status: number, code: string, message: string) =>
    HttpResponse.json({ code, message }, { status })
  const forbidden = () => failure(403, "FORBIDDEN", "Access denied")
  const writeFailure = async (request: Request) => {
    if (scenario === "saveLoading") await delay("infinite")
    if (scenario === "saveForbidden") {
      revoked = true
      return forbidden()
    }
    if (scenario === "saveUnauthorized")
      return failure(401, "UNAUTHENTICATED", "Authentication required")
    if (scenario === "lastOwner")
      return failure(
        409,
        "LAST_OWNER_REQUIRED",
        "The organization must retain at least one owner."
      )
    if (scenario === "stale" && !rejectedOnce) {
      rejectedOnce = true
      version++
    }
    if (request.headers.get("X-Expected-Authz-Version") !== String(version))
      return failure(
        409,
        "AUTHORIZATION_VERSION_CONFLICT",
        "Authorization changed. Refresh and try again."
      )
    if (
      !rejectedOnce &&
      ["saveUnavailable", "rateLimited"].includes(scenario)
    ) {
      rejectedOnce = true
      return failure(
        scenario === "rateLimited" ? 429 : 503,
        "INTERNAL_ERROR",
        "The action failed. Please try again."
      )
    }
    await delay(500)
  }
  return {
    // 原生写、版本冲突和读回共享同一事实；重跑场景不能沿用上一轮的成员关系。
    reset: () => {
      members = structuredClone(base)
      version = 3
      rejectedOnce = false
      revoked = false
    },
    handlers: [
      http.get("*/api/auth/get-session", () =>
        HttpResponse.json({
          user: { ...memberDirectoryUser, emailVerified: true },
          session: {
            id: "members-session",
            userId: memberDirectoryUser.id,
            activeOrganizationId: organizationId,
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        })
      ),
      http.get("*/api/auth/organization/list-members", async ({ request }) => {
        if (scenario === "loading") await delay("infinite")
        if (scenario === "slow") await delay(700)
        if (scenario === "unavailable")
          return failure(503, "INTERNAL_ERROR", "Member directory unavailable")
        if (scenario === "forbidden" || revoked) return forbidden()
        if (scenario === "unauthorized")
          return failure(401, "UNAUTHENTICATED", "Authentication required")
        const search = new URL(request.url).searchParams
        if (search.get("organizationId") !== organizationId) return forbidden()
        const q = search.get("q")?.toLowerCase()
        const role = search.get("filterValue")
        const sortBy = search.get("sortBy") === "role" ? "role" : "createdAt"
        const direction = search.get("sortDirection") === "asc" ? 1 : -1
        const filtered = (scenario === "empty" ? [] : members)
          .filter(
            (row) =>
              (!q ||
                `${row.user.name} ${row.user.email}`
                  .toLowerCase()
                  .includes(q)) &&
              (!role || row.role === role)
          )
          .sort(
            (a, b) =>
              direction * a[sortBy].localeCompare(b[sortBy]) ||
              a.id.localeCompare(b.id)
          )
        const offset = Number(search.get("offset"))
        const limit = Number(search.get("limit"))
        return HttpResponse.json({
          members: filtered.slice(offset, offset + limit),
          total: filtered.length,
        })
      }),
      http.get("*/api/auth/organization/get-active-member-role", () =>
        revoked ? forbidden() : HttpResponse.json({ role: actorRole })
      ),
      http.post(
        "*/api/auth/organization/has-permission",
        async ({ request }) => {
          const input = (await request.json()) as {
            organizationId: string
            permissions: Record<string, string[]>
          }
          if (scenario === "permissionUnavailable" && input.permissions.member)
            return failure(
              503,
              "INTERNAL_ERROR",
              "Member permissions unavailable"
            )
          const actions = input.permissions.member
          const manager = actorRole === "owner" || actorRole === "admin"
          return HttpResponse.json({
            success:
              !revoked &&
              input.organizationId === organizationId &&
              (actions
                ? actorRole !== "member" &&
                  actions.every(
                    (action) =>
                      (action === "update" && scenario !== "deleteOnly") ||
                      (action === "delete" && scenario !== "updateOnly")
                  )
                : manager),
          })
        }
      ),
      http.get("*/api/auth/organization/list-invitations", () =>
        HttpResponse.json([])
      ),
      http.get("*/api/auth/organization/list-roles", async () => {
        if (scenario === "rolesLoading") await delay("infinite")
        if (scenario === "rolesUnavailable")
          return failure(503, "INTERNAL_ERROR", "Role directory unavailable")
        if (actorRole !== "owner" && actorRole !== "admin") return forbidden()
        return HttpResponse.json([
          {
            id: "c7dd0a27-4f8a-4aef-8d4c-000000006201",
            organizationId,
            role: "project-editor",
            permission: { project: ["read", "update"] },
            createdAt: "2026-09-01T00:00:00.000Z",
            memberCount: members.filter((row) => row.role === "project-editor")
              .length,
            invitationCount: 0,
            authorizationVersion: version,
          },
        ])
      }),
      http.get(
        "*/api/v1/organizations/:organizationId/access",
        ({ params }) => {
          if (params.organizationId !== organizationId || revoked)
            return forbidden()
          if (scenario === "accessUnavailable")
            return failure(
              503,
              "INTERNAL_ERROR",
              "Organization access unavailable"
            )
          return HttpResponse.json({
            organizationId,
            status: "ACTIVE",
            authorizationVersion: version,
            effectiveLocale: "en-US",
            effectiveLocaleSource: "platform",
          })
        }
      ),
      http.post(
        "*/api/auth/organization/update-member-role",
        async ({ request }) => {
          const input = (await request.json()) as {
            organizationId: string
            memberId: string
            role: string
          }
          if (input.organizationId !== organizationId) return forbidden()
          const rejected = await writeFailure(request)
          if (rejected) return rejected
          const member = members.find((row) => row.id === input.memberId)!
          member.role = input.role
          version++
          return HttpResponse.json(member)
        }
      ),
      http.post(
        "*/api/auth/organization/remove-member",
        async ({ request }) => {
          const input = (await request.json()) as {
            organizationId: string
            memberIdOrEmail: string
          }
          if (input.organizationId !== organizationId) return forbidden()
          const rejected = await writeFailure(request)
          if (rejected) return rejected
          const member = members.find(
            (row) => row.id === input.memberIdOrEmail
          )!
          members = members.filter((row) => row !== member)
          version++
          return HttpResponse.json(member)
        }
      ),
      http.post(
        "*/api/auth/organization/leave",
        async ({ request }) =>
          (await writeFailure(request)) ?? HttpResponse.json({ success: true })
      ),
    ],
  }
}
