import { http, HttpResponse, delay } from "msw"
import {
  ProjectListQuerySchema,
  SupportedLocaleSchema,
  type ApiError,
  type ProjectPage,
} from "@workspace/contracts"
import { projectFixtures } from "../fixtures/projects"

export type ProjectsScenario =
  | "success"
  | "empty"
  | "forbidden"
  | "serverError"
  | "slow"
  | "loading"
  | "longText"
export function createProjectsHandler(scenario: ProjectsScenario = "success") {
  return http.get(
    "*/api/v1/organizations/:organizationId/projects",
    async ({ request, params }) => {
      const locale = SupportedLocaleSchema.parse(
        request.headers.get("Accept-Language") ?? "zh-CN"
      )
      const headers = { "Content-Language": locale, Vary: "Accept-Language" }
      if (scenario === "loading") await delay("infinite")
      if (scenario === "slow") await delay(700)
      if (scenario === "forbidden" || scenario === "serverError") {
        return HttpResponse.json(
          {
            code: scenario === "forbidden" ? "FORBIDDEN" : "INTERNAL_ERROR",
            message:
              scenario === "forbidden"
                ? "Access denied"
                : "Internal server error",
            requestId: "storybook-projects",
            locale,
          } satisfies ApiError,
          { status: scenario === "forbidden" ? 403 : 500, headers }
        )
      }
      const query = ProjectListQuerySchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams)
      )
      if (!query.success)
        return HttpResponse.json(
          {
            code: "VALIDATION_ERROR",
            message: "Invalid request parameters",
            requestId: "storybook-projects",
            locale,
          } satisfies ApiError,
          { status: 400, headers }
        )
      const { page, pageSize, name, status, sortBy, sortOrder } = query.data
      let rows =
        scenario === "empty"
          ? []
          : projectFixtures(String(params.organizationId), locale)
      if (scenario === "longText")
        rows = rows.map((row) => ({ ...row, name: row.name.repeat(15) }))
      rows = rows.filter(
        (row) =>
          (!status || row.status === status) &&
          (!name ||
            row.name
              .toLocaleLowerCase(locale)
              .includes(name.toLocaleLowerCase(locale)))
      )
      rows.sort((a, b) => {
        const order = a[sortBy].localeCompare(b[sortBy])
        return (
          (sortOrder === "asc" ? order : -order) || a.id.localeCompare(b.id)
        )
      })
      return HttpResponse.json(
        {
          items: rows.slice((page - 1) * pageSize, page * pageSize),
          page,
          pageSize,
          total: rows.length,
        } satisfies ProjectPage,
        { headers }
      )
    }
  )
}
