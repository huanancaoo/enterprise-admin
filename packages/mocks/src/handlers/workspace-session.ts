import { delay, http, HttpResponse } from "msw"
import { organizations } from "../fixtures/projects"
import type { MyPreferences, OrganizationStatus } from "@workspace/contracts"

export function createWorkspaceSessionHandlers(options?: {
  suspendedIds?: readonly string[]
  refreshDelay?: number | "infinite"
  listDelay?: number
}) {
  const suspended = new Set(options?.suspendedIds ?? [])
  let activeId: string = organizations[0].id
  const teams = organizations.map((organization, index) => ({
    ...organization,
    slug: index === 0 ? "north" : "south",
    status: (suspended.has(organization.id)
      ? "SUSPENDED"
      : "ACTIVE") as OrganizationStatus,
    createdAt: "2026-09-01T00:00:00.000Z",
  }))
  const error = (code: "FORBIDDEN" | "ORGANIZATION_SUSPENDED") =>
    HttpResponse.json(
      {
        code,
        message: code,
        requestId: "storybook-organization",
        locale: "zh-CN",
      },
      { status: 403 }
    )
  return [
    http.get("*/api/auth/get-session", () =>
      HttpResponse.json({
        user: {
          id: "layout-user",
          name: "布局测试用户",
          email: "layout@example.com",
          emailVerified: true,
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
        session: {
          id: "layout-session",
          token: "storybook-session",
          userId: "layout-user",
          activeOrganizationId: activeId,
          expiresAt: "2099-01-01T00:00:00.000Z",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      })
    ),
    http.get("*/api/v1/me/preferences", () =>
      HttpResponse.json({
        preferredLocale: null,
        version: 1,
        effectiveLocale: "zh-CN",
        effectiveLocaleSource: "request",
      } satisfies MyPreferences)
    ),
    http.get("*/api/v1/me/organizations", async () => {
      if (options?.listDelay !== undefined) await delay(options.listDelay)
      if (
        activeId !== organizations[0].id &&
        options?.refreshDelay !== undefined
      )
        await delay(options.refreshDelay)
      return HttpResponse.json(
        teams.map(({ id, name, slug, status }) => ({ id, name, slug, status }))
      )
    }),
    http.get("*/api/v1/organizations/:organizationId/access", ({ params }) => {
      const organizationId = String(params.organizationId)
      const team = teams.find((item) => item.id === organizationId)
      if (!team) return error("FORBIDDEN")
      if (team.status === "SUSPENDED") return error("ORGANIZATION_SUSPENDED")
      return HttpResponse.json({
        organizationId,
        status: "ACTIVE",
        authorizationVersion: 1,
        effectiveLocale: "zh-CN",
      })
    }),
    http.post("*/api/auth/organization/set-active", async ({ request }) => {
      const body = (await request.json()) as { organizationId: string }
      const team = teams.find((item) => item.id === body.organizationId)
      if (!team || team.status === "SUSPENDED")
        return error("ORGANIZATION_SUSPENDED")
      activeId = body.organizationId
      return HttpResponse.json(team)
    }),
    http.post("*/api/auth/organization/has-permission", async ({ request }) => {
      const body = (await request.json()) as {
        organizationId: string
        permissions?: { tenantSettings?: string[] }
      }
      const team = teams.find((item) => item.id === body.organizationId)
      const grantedActions = new Set(["read", "update"])
      const requestedActions = body.permissions?.tenantSettings ?? []
      const success =
        team?.status === "ACTIVE" &&
        requestedActions.every((action) => grantedActions.has(action))
      return HttpResponse.json({
        success,
        error: success ? null : "ROLE_MISMATCH",
      })
    }),
  ]
}
