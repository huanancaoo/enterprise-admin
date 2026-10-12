import { http, HttpResponse } from "msw"
import {
  BusinessTaskSchema,
  CreateProjectImportSchema,
  CreateProjectExportSchema,
  OrganizationAccessSchema,
} from "@workspace/contracts"
import { taskCenterOrganizationId, taskCenterTask } from "./task-center"
export function createProjectExchangeScenario() {
  const requests: {
    body: unknown
    key: string | null
    locale: string | null
  }[] = []
  return {
    requests,
    reset: () => {
      requests.splice(0)
    },
    handlers: [
      http.get("*/api/v1/organizations/:organizationId/access", () =>
        HttpResponse.json(
          OrganizationAccessSchema.parse({
            organizationId: taskCenterOrganizationId,
            status: "ACTIVE",
            authorizationVersion: 1,
            effectiveLocale: "en-US",
            effectiveLocaleSource: "user",
          })
        )
      ),
      http.post("*/api/auth/organization/has-permission", () =>
        HttpResponse.json({ success: true })
      ),
      http.post(
        "*/api/v1/organizations/:organizationId/projects/imports",
        async ({ request }) => {
          requests.push({
            body: CreateProjectImportSchema.parse(await request.json()),
            key: request.headers.get("Idempotency-Key"),
            locale: request.headers.get("Accept-Language"),
          })
          return HttpResponse.json(
            BusinessTaskSchema.parse({
              ...taskCenterTask,
              type: "projects.import",
              status: "submitted",
              errorCode: null,
              result: null,
              resultAvailable: false,
            }),
            { status: 202 }
          )
        }
      ),
      http.post(
        "*/api/v1/organizations/:organizationId/projects/exports",
        async ({ request }) => {
          requests.push({
            body: CreateProjectExportSchema.parse(await request.json()),
            key: request.headers.get("Idempotency-Key"),
            locale: request.headers.get("Accept-Language"),
          })
          return HttpResponse.json(
            BusinessTaskSchema.parse({
              ...taskCenterTask,
              type: "projects.export",
              status: "submitted",
              errorCode: null,
              result: null,
              resultAvailable: false,
            }),
            { status: 202 }
          )
        }
      ),
    ],
  }
}
