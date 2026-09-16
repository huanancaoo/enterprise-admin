import { http, HttpResponse } from "msw"
import { organizations } from "../fixtures/projects"

export function createWorkspaceSessionHandlers() {
  let activeId: string = organizations[0].id
  const teams = organizations.map((organization, index) => ({
    ...organization,
    slug: index === 0 ? "north" : "south",
    createdAt: "2026-09-01T00:00:00.000Z",
  }))
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
    http.get("*/api/auth/organization/list", () => HttpResponse.json(teams)),
    http.get("*/api/auth/organization/get-full-organization", () =>
      HttpResponse.json({
        ...teams.find((team) => team.id === activeId),
        members: [],
        invitations: [],
      })
    ),
    http.post("*/api/auth/organization/set-active", async ({ request }) => {
      const body = (await request.json()) as { organizationId: string }
      activeId = body.organizationId
      return HttpResponse.json(teams.find((team) => team.id === activeId))
    }),
  ]
}
