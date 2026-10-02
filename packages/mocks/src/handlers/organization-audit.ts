import { delay, http, HttpResponse } from "msw"
import { AuditEventsQuerySchema, type AuditEvent } from "@workspace/contracts"
import { organizations } from "../fixtures/projects"

export const organizationAuditFixture: AuditEvent = {
  id: "c7dd0a27-4f8a-4aef-8d4c-000000003001",
  occurredAt: "2026-10-02T00:00:00.000Z",
  eventCode: "project.updated",
  scope: "tenant",
  actorType: "user",
  actorId: "c7dd0a27-4f8a-4aef-8d4c-000000001001",
  resourceType: "project",
  resourceId: "c7dd0a27-4f8a-4aef-8d4c-000000004001",
  result: "succeeded",
  publicSummary: null,
  metadata: { changedFields: ["name"] },
}
export const organizationAuditSummary =
  "Organization access was suspended by platform."

export type OrganizationAuditScenario =
  | "success"
  | "loading"
  | "slow"
  | "empty"
  | "unavailable"
  | "forbidden"
  | "unauthorized"
  | "rateLimited"
  | "retryable"
  | "longText"
  | "paginated"
  | "systemActor"
  | "detailLoading"
  | "detailError"
  | "detailNotFound"
  | "detailForbidden"
  | "detailUnauthorized"

export function createOrganizationAuditScenario(
  scenario: OrganizationAuditScenario = "success"
) {
  // 保持默认时间窗口真实有效，筛选和游标作用于同一批租户可见事实。
  const at = Date.now() - 60_000
  const records: AuditEvent[] = Array.from(
    { length: scenario === "paginated" ? 25 : 2 },
    (_, index) => ({
      ...structuredClone(organizationAuditFixture),
      id: "c7dd0a27-4f8a-4aef-8d4c-" + String(index + 3001).padStart(12, "0"),
      occurredAt: new Date(at - index * 60_000).toISOString(),
    })
  )
  Object.assign(records.at(-1)!, {
    scope: "platform",
    eventCode: "platform.organization_suspended",
    resourceType: "organization",
    resourceId: organizations[0].id,
    publicSummary: organizationAuditSummary,
    metadata: {},
  })
  if (scenario === "longText") {
    records[0].resourceType = "international-research-project-".repeat(4)
    records[0].metadata = { description: "国际研发与合规协作记录 ".repeat(60) }
  }
  if (scenario === "systemActor")
    Object.assign(records[0], { actorType: "system", actorId: null })
  let failed = false
  const failure = (status: number, code: string) =>
    HttpResponse.json(
      {
        code,
        message: code,
        requestId: "storybook-organization-audit",
        locale: "en-US",
      },
      { status }
    )
  return {
    reset: () => {
      failed = false
    },
    handlers: [
      http.get(
        "*/api/v1/organizations/:organizationId/audit-events",
        async ({ params, request }) => {
          if (params.organizationId !== organizations[0].id)
            return failure(403, "FORBIDDEN")
          const query = AuditEventsQuerySchema.parse(
            Object.fromEntries(new URL(request.url).searchParams)
          )
          if (scenario === "loading") await delay("infinite")
          if (scenario === "slow") await delay(700)
          if (scenario === "forbidden") return failure(403, "FORBIDDEN")
          if (scenario === "unauthorized")
            return failure(401, "UNAUTHENTICATED")
          if (scenario === "rateLimited") return failure(429, "INTERNAL_ERROR")
          if (scenario === "unavailable")
            return failure(503, "AUDIT_UNAVAILABLE")
          if (scenario === "retryable" && !failed) {
            failed = true
            return failure(503, "AUDIT_UNAVAILABLE")
          }
          const upper = query.to ? Date.parse(query.to) : Date.now()
          const lower = query.from
            ? Date.parse(query.from)
            : upper - 30 * 86400000
          const matching = (scenario === "empty" ? [] : records).filter(
            (record) =>
              Date.parse(record.occurredAt) >= lower &&
              Date.parse(record.occurredAt) <= upper &&
              (!query.actorId || query.actorId === record.actorId) &&
              (!query.eventCode || query.eventCode === record.eventCode) &&
              (!query.resourceType ||
                query.resourceType === record.resourceType) &&
              (!query.resourceId || query.resourceId === record.resourceId) &&
              (!query.result || query.result === record.result)
          )
          const before = query.cursor
            ? matching.findIndex((record) => record.id === query.cursor)
            : undefined
          if (before === -1) return failure(400, "VALIDATION_ERROR")
          const offset = before === undefined ? 0 : before + 1
          const page = matching.slice(offset, offset + query.limit)
          // 这里仅模拟 UI 对不透明游标的消费；真实游标签名和租户隔离由 HTTP 套件证明。
          return HttpResponse.json({
            items: page,
            nextCursor:
              offset + query.limit < matching.length ? page.at(-1)!.id : null,
          })
        }
      ),
      http.get(
        "*/api/v1/organizations/:organizationId/audit-events/:eventId",
        async ({ params }) => {
          if (params.organizationId !== organizations[0].id)
            return failure(403, "FORBIDDEN")
          if (scenario === "detailLoading") await delay("infinite")
          if (scenario === "detailError")
            return failure(503, "AUDIT_UNAVAILABLE")
          if (scenario === "detailNotFound") return failure(404, "NOT_FOUND")
          if (scenario === "detailForbidden") return failure(403, "FORBIDDEN")
          if (scenario === "detailUnauthorized")
            return failure(401, "UNAUTHENTICATED")
          const record = records.find((item) => item.id === params.eventId)
          return record ? HttpResponse.json(record) : failure(404, "NOT_FOUND")
        }
      ),
    ],
  }
}
