import { http, HttpResponse } from "msw"
import { OrganizationAccessSchema } from "@workspace/contracts"
import { organizations } from "../fixtures/projects"
import {
  createProjectAttachmentsScenario,
  projectAttachmentItem,
} from "./project-attachments"
import {
  createProjectDetailHandler,
  createProjectDeleteHandler,
  createProjectEditHandlers,
} from "./project-detail"

function permissionGate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

export function createProjectAccessScenario(
  mode: "shared" | "denied" | "error"
) {
  let authorizationVersion = 1
  let gate = permissionGate()
  const checks: {
    organizationId: string
    authorizationVersion: number
    action: "update" | "translate"
  }[] = []
  const handlers = [
    http.get("*/api/v1/organizations/:organizationId/access", ({ params }) =>
      HttpResponse.json(
        OrganizationAccessSchema.parse({
          organizationId: params.organizationId,
          status: "ACTIVE",
          authorizationVersion,
          effectiveLocale: "zh-CN",
          effectiveLocaleSource: "organization",
        })
      )
    ),
    http.post("*/api/auth/organization/has-permission", async ({ request }) => {
      const input = (await request.json()) as {
        organizationId: string
        permissions: Record<string, string[]>
      }
      const action = input.permissions.project?.[0]
      if (action !== "update" && action !== "translate")
        return HttpResponse.json({ success: true, error: null })
      checks.push({
        organizationId: input.organizationId,
        authorizationVersion,
        action,
      })
      if (mode === "denied") await gate.promise
      if (mode === "error")
        return HttpResponse.json(
          { code: "INTERNAL_ERROR", message: "Projection unavailable" },
          { status: 500 }
        )
      return HttpResponse.json({
        success:
          mode === "shared" &&
          input.organizationId === organizations[0].id &&
          (authorizationVersion === 1 || action === "translate"),
        error: null,
      })
    }),
    ...createProjectAttachmentsScenario({ items: [projectAttachmentItem] })
      .handlers,
    ...createProjectEditHandlers(),
    createProjectDeleteHandler(),
    createProjectDetailHandler(),
  ]
  return {
    handlers,
    checks,
    reset: () => {
      checks.length = 0
      authorizationVersion = 1
      gate.release()
      gate = permissionGate()
    },
    release: () => gate.release(),
    advance: () => authorizationVersion++,
  }
}
