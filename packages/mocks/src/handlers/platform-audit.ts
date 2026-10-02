import { delay, http, HttpResponse } from "msw"
import {
  PlatformAuditPurposeSchema,
  PlatformAuditQuerySchema,
  type PlatformAuditEvent,
} from "@workspace/contracts"
import {
  platformOrganizationActor,
  platformOrganizationFixture,
} from "./platform-organizations"

export const platformAuditFixture: PlatformAuditEvent = {
  id: "event:c7dd0a27-4f8a-4aef-8d4c-000000002001",
  occurredAt: "2026-10-01T00:00:00.000Z",
  scope: "platform",
  targetOrganization: {
    organizationId: platformOrganizationFixture.id,
    name: platformOrganizationFixture.name,
  },
  eventCode: "platform.organization_suspended",
  actorType: "user",
  actorId: platformOrganizationActor.id,
  actorMaskedEmail: "o***@example.test",
  resourceType: "organization",
  resourceId: platformOrganizationFixture.id,
  result: "succeeded",
  metadata: {},
}

export type PlatformAuditScenario =
  | "success"
  | "loading"
  | "slow"
  | "empty"
  | "longText"
  | "unauthorized"
  | "forbidden"
  | "unavailable"
  | "retryable"
  | "paginated"
  | "detailLoading"
  | "detailError"
  | "detailNotFound"
  | "detailForbidden"
  | "detailUnauthorized"
  | "roleChange"

export function createPlatformAuditScenario(
  scenario: PlatformAuditScenario = "success"
) {
  // 相对时间保证记录属于页面默认 30 天窗口；不会通过返回过期记录伪造空状态。
  const at = Date.now() - 60_000
  const events: PlatformAuditEvent[] = Array.from(
    { length: scenario === "paginated" ? 25 : 2 },
    (_, index) => ({
      ...structuredClone(platformAuditFixture),
      id: `event:c7dd0a27-4f8a-4aef-8d4c-${String(index + 2001).padStart(12, "0")}`,
      occurredAt: new Date(at - index * 60_000).toISOString(),
    })
  )
  Object.assign(events.at(-1)!, {
    eventCode: "member.role_changed",
    scope: "tenant",
    targetOrganization: {
      organizationId: "c7dd0a27-4f8a-4aef-8d4c-000000000002",
      name: "South workspace",
    },
    resourceType: "member",
    resourceId: "c7dd0a27-4f8a-4aef-8d4c-000000001002",
    result: "denied",
  })
  if (scenario === "longText")
    events[0].targetOrganization!.name = "国际研发与合规协作组织 ".repeat(18)
  if (scenario === "roleChange")
    Object.assign(events[0], {
      id: "assignment:c7dd0a27-4f8a-4aef-8d4c-000000002001",
      eventCode: "platform.role_granted",
      actorType: "deployment_operator",
      actorId: null,
      actorMaskedEmail: null,
      targetOrganization: null,
      resourceType: "platform_assignment",
      resourceId: "c7dd0a27-4f8a-4aef-8d4c-000000001001",
      metadata: { previousRole: null, nextRole: "platform_auditor" },
    })
  let failed = false
  const failure = (status: number, code: string) =>
    HttpResponse.json(
      { code, message: code, locale: "en-US", requestId: "storybook-audit" },
      { status }
    )
  const readFailure = async () => {
    if (scenario === "loading") await delay("infinite")
    if (scenario === "slow") await delay(700)
    if (scenario === "unauthorized") return failure(401, "UNAUTHENTICATED")
    if (scenario === "forbidden") return failure(403, "FORBIDDEN")
    if (scenario === "unavailable") return failure(503, "AUDIT_UNAVAILABLE")
    if (scenario === "retryable" && !failed) {
      failed = true
      return failure(503, "AUDIT_UNAVAILABLE")
    }
  }
  return {
    reset: () => {
      failed = false
    },
    handlers: [
      http.get("*/api/v1/platform/audit-events", async ({ request }) => {
        const query = PlatformAuditQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams)
        )
        const rejected = await readFailure()
        if (rejected) return rejected
        const upper = query.to ? Date.parse(query.to) : Date.now()
        const lower = query.from
          ? Date.parse(query.from)
          : upper - 30 * 86400000
        const matching = (scenario === "empty" ? [] : events).filter(
          (event) =>
            Date.parse(event.occurredAt) >= lower &&
            Date.parse(event.occurredAt) <= upper &&
            (!query.organizationId ||
              event.targetOrganization?.organizationId ===
                query.organizationId) &&
            (!query.actorId || event.actorId === query.actorId) &&
            (!query.eventCode || event.eventCode === query.eventCode) &&
            (!query.result || event.result === query.result)
        )
        const before = query.cursor
          ? matching.findIndex((event) => event.id === query.cursor)
          : undefined
        if (before === -1) return failure(400, "VALIDATION_ERROR")
        const offset = before === undefined ? 0 : before + 1
        const limit = query.limit ?? 20
        const page = matching.slice(offset, offset + limit)
        // UI 只消费不透明游标；签名与筛选绑定由真实 HTTP 套件验收。
        return HttpResponse.json({
          items: page,
          nextCursor: offset + limit < matching.length ? page.at(-1)!.id : null,
        })
      }),
      http.get(
        "*/api/v1/platform/audit-events/:eventId",
        async ({ request, params }) => {
          PlatformAuditPurposeSchema.parse(
            Object.fromEntries(new URL(request.url).searchParams)
          )
          if (scenario === "detailLoading") await delay("infinite")
          if (scenario === "detailError")
            return failure(503, "AUDIT_UNAVAILABLE")
          if (scenario === "detailNotFound") return failure(404, "NOT_FOUND")
          if (scenario === "detailForbidden") return failure(403, "FORBIDDEN")
          if (scenario === "detailUnauthorized")
            return failure(401, "UNAUTHENTICATED")
          const event = events.find((item) => item.id === params.eventId)
          return event ? HttpResponse.json(event) : failure(404, "NOT_FOUND")
        }
      ),
    ],
  }
}
