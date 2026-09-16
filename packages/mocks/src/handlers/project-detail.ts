import { delay, http, HttpResponse } from "msw"
import {
  SupportedLocaleSchema,
  UpdateProjectSchema,
  type ApiError,
  type ProjectResponse,
} from "@workspace/contracts"
import { projectFixtures } from "../fixtures/projects"

export type ProjectDetailScenario =
  "success" | "loading" | "forbidden" | "notFound" | "serverError" | "longText"

export type ProjectEditScenario = "success" | "error" | "refreshDraft"

export type ProjectDeleteScenario = "success" | "loading" | "error"

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

export function createProjectEditHandlers(
  scenario: ProjectEditScenario = "success"
) {
  let translationReads = 0
  return [
    http.get(
      /\/api\/v1\/organizations\/(?<organizationId>[^/]+)\/projects\/(?<projectId>[^/]+)\/translations\/(?<locale>[^/?]+)$/,
      ({ params }) => {
        const locale = SupportedLocaleSchema.parse(params.locale)
        translationReads += 1
        return HttpResponse.json({
          locale,
          name:
            scenario === "refreshDraft" && translationReads > 1
              ? "Server refreshed content"
              : `Original ${locale} content`,
          description: null,
        })
      }
    ),
    http.patch(
      /\/api\/v1\/organizations\/(?<organizationId>[^/]+)\/projects\/(?<projectId>[^/?]+)$/,
      async ({ request, params }) => {
        const input = UpdateProjectSchema.parse(await request.json())
        if (scenario === "error")
          return HttpResponse.json(
            {
              code: "INTERNAL_ERROR",
              message: "Update failed",
              requestId: "storybook-project-update",
              locale: "zh-CN",
            } satisfies ApiError,
            { status: 500 }
          )
        const locale = SupportedLocaleSchema.parse(
          request.headers.get("Accept-Language") ?? "zh-CN"
        )
        const project = projectFixtures(
          String(params.organizationId),
          locale
        ).find((item) => item.id === params.projectId)
        if (!project)
          return HttpResponse.json(
            {
              code: "NOT_FOUND",
              message: "NOT_FOUND",
              requestId: "storybook-project-update",
              locale,
            } satisfies ApiError,
            { status: 404 }
          )
        return HttpResponse.json({
          ...project,
          status: input.status ?? project.status,
        } satisfies ProjectResponse)
      }
    ),
  ]
}

export function createProjectDeleteHandler(
  scenario: ProjectDeleteScenario = "success"
) {
  return http.delete(
    /\/api\/v1\/organizations\/(?<organizationId>[^/]+)\/projects\/(?<projectId>[^/?]+)$/,
    async ({ request }) => {
      const locale = SupportedLocaleSchema.parse(
        request.headers.get("Accept-Language") ?? "zh-CN"
      )
      if (scenario === "loading") await delay("infinite")
      if (scenario === "error")
        return HttpResponse.json(
          {
            code: "INTERNAL_ERROR",
            message: "Delete failed",
            requestId: "storybook-project-delete",
            locale,
          } satisfies ApiError,
          { status: 500, headers: { "Content-Language": locale } }
        )
      return new HttpResponse(null, { status: 204 })
    }
  )
}
