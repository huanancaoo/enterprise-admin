import { delay, http, HttpResponse } from "msw"
import {
  SupportedLocaleSchema,
  type ApiError,
  type ProjectResponse,
} from "@workspace/contracts"
import { projectFixtures } from "../fixtures/projects"

export type ProjectDetailScenario =
  "success" | "loading" | "forbidden" | "notFound" | "serverError" | "longText"

export function createProjectDetailHandler(
  scenario: ProjectDetailScenario = "success"
) {
  return http.get(
    "*/api/v1/organizations/:organizationId/projects/:projectId",
    async ({ request, params }) => {
      const locale = SupportedLocaleSchema.parse(
        request.headers.get("Accept-Language") ?? "zh-CN"
      )
      const headers = { "Content-Language": locale, Vary: "Accept-Language" }
      if (scenario === "loading") await delay("infinite")
      const status =
        scenario === "forbidden"
          ? 403
          : scenario === "notFound"
            ? 404
            : scenario === "serverError"
              ? 500
              : undefined
      if (status) {
        const code =
          status === 403
            ? "FORBIDDEN"
            : status === 404
              ? "NOT_FOUND"
              : "INTERNAL_ERROR"
        return HttpResponse.json(
          {
            code,
            message: code,
            requestId: "storybook-project-detail",
            locale,
          } satisfies ApiError,
          { status, headers }
        )
      }
      const project = projectFixtures(
        String(params.organizationId),
        locale
      ).find((item) => item.id === params.projectId)
      if (!project)
        return HttpResponse.json(
          {
            code: "NOT_FOUND",
            message: "NOT_FOUND",
            requestId: "storybook-project-detail",
            locale,
          } satisfies ApiError,
          { status: 404, headers }
        )
      const response: ProjectResponse =
        scenario === "longText"
          ? {
              ...project,
              name: project.name.repeat(12),
              description: "详情长文本。".repeat(120),
            }
          : { ...project, description: "用于验证项目详情的描述。" }
      return HttpResponse.json(response, { headers })
    }
  )
}
