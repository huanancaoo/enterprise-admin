import { delay, http, HttpResponse } from "msw"
import { CreateProjectSchema } from "@workspace/contracts"

export function createProjectHandler(
  scenario: "success" | "error" | "pending" = "success"
) {
  return http.post(
    "*/api/v1/organizations/:organizationId/projects",
    async ({ request, params }) => {
      const input = CreateProjectSchema.parse(await request.json())
      await delay(scenario === "pending" ? "infinite" : 250)
      if (scenario === "error")
        return HttpResponse.json(
          {
            code: "INTERNAL_ERROR",
            message: "Creation failed",
            requestId: "story-create",
            locale: "zh-CN",
          },
          { status: 500 }
        )
      const contentLocale = input.contentLocale ?? "zh-CN"
      return HttpResponse.json(
        {
          id: "00000000-0000-4000-8000-000000000003",
          organizationId: params.organizationId,
          name: input.name,
          description: input.description,
          status: "draft",
          contentLocale,
          resolvedLocale: contentLocale,
          createdAt: "2026-09-16T00:00:00.000Z",
          updatedAt: "2026-09-16T00:00:00.000Z",
        },
        { status: 201 }
      )
    }
  )
}
