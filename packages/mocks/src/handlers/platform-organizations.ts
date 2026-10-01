import { delay, http, HttpResponse } from "msw"
import {
  PlatformOrganizationQuerySchema,
  TransitionOrganizationSchema,
  type PlatformOrganizationDetail,
  type OrganizationTransitionResult,
} from "@workspace/contracts"

export const platformOrganizationActor = {
  id: "d6da9c25-56a2-46f1-b5d8-2f17ff3e3204",
  name: "Platform operator",
  email: "operator@example.test",
}

export const platformOrganizationFixture: PlatformOrganizationDetail = {
  id: "c7dd0a27-4f8a-4aef-8d4c-000000000001",
  name: "North workspace",
  slug: "north-workspace",
  status: "ACTIVE",
  createdAt: "2026-09-16T00:00:00.000Z",
  memberCount: 20,
  version: 3,
  defaultLocale: "en-US",
  statusChangedAt: "2026-10-01T00:00:00.000Z",
  members: [
    { role: "owner", count: 2 },
    { role: "admin", count: 3 },
    { role: "member", count: 15 },
  ],
  history: [
    {
      id: "c7dd0a27-4f8a-4aef-8d4c-000000000101",
      occurredAt: "2026-10-01T00:00:00.000Z",
      eventCode: "platform.organization_resumed",
      actorId: platformOrganizationActor.id,
      result: "succeeded",
      operationId: "c7dd0a27-4f8a-4aef-8d4c-000000000201",
    },
    {
      id: "c7dd0a27-4f8a-4aef-8d4c-000000000102",
      occurredAt: "2026-09-30T00:00:00.000Z",
      eventCode: "platform.organization_suspended",
      actorId: platformOrganizationActor.id,
      result: "succeeded",
      operationId: "c7dd0a27-4f8a-4aef-8d4c-000000000202",
    },
  ],
}

export type PlatformOrganizationsScenario =
  | "success"
  | "loading"
  | "slow"
  | "empty"
  | "emptyHistory"
  | "longText"
  | "unauthorized"
  | "forbidden"
  | "unavailable"
  | "notFound"
  | "paginated"
  | "suspended"
  | "stale"
  | "rateLimited"
  | "mfaRequired"

// 每个场景持有独立组织状态；页面写入后仍通过同一目录和详情读回事实。
export function createPlatformOrganizationScenario(
  scenario: PlatformOrganizationsScenario = "success"
) {
  let organization = structuredClone(platformOrganizationFixture)
  if (scenario === "emptyHistory")
    organization = {
      ...organization,
      version: 1,
      statusChangedAt: organization.createdAt,
      history: [],
    }
  if (scenario === "suspended")
    organization = {
      ...organization,
      status: "SUSPENDED",
      version: 2,
      history: [organization.history[1]],
    }
  if (scenario === "longText")
    organization = {
      ...organization,
      name: "国际研发与合规协作组织 ".repeat(18),
      slug: "international-research-compliance-".repeat(8),
      members: [
        { role: "owner", count: 2 },
        { role: "international-research-compliance-reviewer", count: 18 },
      ],
    }
  const otherOrganizations: PlatformOrganizationDetail[] = Array.from(
    { length: scenario === "paginated" ? 24 : 1 },
    (_, index) => ({
      ...structuredClone(platformOrganizationFixture),
      id: `c7dd0a27-4f8a-4aef-8d4c-${String(index + 2).padStart(12, "0")}`,
      name:
        index === 0 ? "South workspace" : `Operations workspace ${index + 2}`,
      slug:
        index === 0 ? "south-workspace" : `operations-workspace-${index + 2}`,
      status: "SUSPENDED",
      version: 2,
      defaultLocale: "ar",
      memberCount: 5,
      members: [
        { role: "owner", count: 1 },
        { role: "member", count: 4 },
      ],
      history: [
        {
          ...structuredClone(platformOrganizationFixture.history[1]),
          id: `c7dd0a27-4f8a-4aef-8d4c-${String(index + 302).padStart(12, "0")}`,
          operationId: `c7dd0a27-4f8a-4aef-8d4c-${String(index + 402).padStart(12, "0")}`,
        },
      ],
    })
  )
  const initialOrganizations = structuredClone([
    organization,
    ...otherOrganizations,
  ])
  let organizations = structuredClone(initialOrganizations)
  let conflictInjected = false
  let rateLimitReturned = false
  let mfaConfirmed = false
  const failure = (status: number, code: string) =>
    HttpResponse.json(
      {
        code,
        message: code,
        requestId: "storybook-organizations",
        locale: "zh-CN",
      },
      { status }
    )
  const readFailure = async () => {
    if (scenario === "loading") await delay("infinite")
    if (scenario === "slow") await delay(700)
    if (scenario === "unauthorized") return failure(401, "UNAUTHENTICATED")
    if (scenario === "forbidden") return failure(403, "FORBIDDEN")
    if (scenario === "unavailable") return failure(503, "AUDIT_UNAVAILABLE")
  }
  const recordStatus = (
    organization: PlatformOrganizationDetail,
    status: PlatformOrganizationDetail["status"],
    operationId: string
  ) => {
    const occurredAt = "2026-10-02T00:00:00.000Z"
    Object.assign(organization, {
      status,
      version: organization.version + 1,
      statusChangedAt: occurredAt,
      history: [
        {
          id: crypto.randomUUID(),
          occurredAt,
          eventCode:
            status === "SUSPENDED"
              ? "platform.organization_suspended"
              : "platform.organization_resumed",
          actorId: platformOrganizationActor.id,
          result: "succeeded",
          operationId,
        },
        ...organization.history,
      ],
    })
  }
  const transition = (action: "suspend" | "resume") =>
    http.post(
      `*/api/v1/platform/organizations/:organizationId/${action}`,
      async ({ request, params }) => {
        const input = TransitionOrganizationSchema.parse(await request.json())
        const organization = organizations.find(
          (item) => item.id === params.organizationId
        )
        if (!organization) return failure(404, "NOT_FOUND")
        if (scenario === "rateLimited" && !rateLimitReturned) {
          rateLimitReturned = true
          return failure(429, "INTERNAL_ERROR")
        }
        if (scenario === "mfaRequired" && !mfaConfirmed)
          return failure(403, "PLATFORM_MFA_REQUIRED")
        if (scenario === "stale" && !conflictInjected) {
          conflictInjected = true
          recordStatus(
            organization,
            organization.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
            crypto.randomUUID()
          )
        }
        if (input.expectedVersion !== organization.version)
          return failure(409, "VERSION_CONFLICT")
        await delay(500)
        const status = action === "suspend" ? "SUSPENDED" : "ACTIVE"
        const changed = organization.status !== status
        const operationId = crypto.randomUUID()
        if (changed) recordStatus(organization, status, operationId)
        return HttpResponse.json({
          organizationId: organization.id,
          status: organization.status,
          version: organization.version,
          changed,
          result: changed ? "succeeded" : "no_change",
          operationId,
        } satisfies OrganizationTransitionResult)
      }
    )
  return {
    reset: () => {
      organizations = structuredClone(initialOrganizations)
      conflictInjected = false
      rateLimitReturned = false
      mfaConfirmed = false
    },
    handlers: [
      http.get("*/api/v1/platform/organizations", async ({ request }) => {
        const rejected = await readFailure()
        if (rejected) return rejected
        const query = PlatformOrganizationQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams)
        )
        const records = scenario === "empty" ? [] : organizations
        const matching = records.filter(
          (item) =>
            (!query.status || item.status === query.status) &&
            (!query.q ||
              `${item.name} ${item.slug}`
                .toLowerCase()
                .includes(query.q.toLowerCase()))
        )
        matching.sort((left, right) => {
          const a = left[query.sortBy]
          const b = right[query.sortBy]
          const compared =
            typeof a === "number" && typeof b === "number"
              ? a - b
              : String(a).localeCompare(String(b))
          return (
            (compared || left.id.localeCompare(right.id)) *
            (query.sortOrder === "asc" ? 1 : -1)
          )
        })
        const offset = (query.page - 1) * query.pageSize
        return HttpResponse.json({
          items: matching
            .slice(offset, offset + query.pageSize)
            .map((item) => ({
              id: item.id,
              name: item.name,
              slug: item.slug,
              status: item.status,
              createdAt: item.createdAt,
              memberCount: item.memberCount,
              version: item.version,
            })),
          total: matching.length,
          page: query.page,
          pageSize: query.pageSize,
        })
      }),
      http.get(
        "*/api/v1/platform/organizations/:organizationId",
        async ({ params }) => {
          const rejected = await readFailure()
          if (rejected) return rejected
          if (scenario === "notFound") return failure(404, "NOT_FOUND")
          const result = organizations.find(
            (item) => item.id === params.organizationId
          )
          return result ? HttpResponse.json(result) : failure(404, "NOT_FOUND")
        }
      ),
      http.get("*/api/v1/me/platform", () =>
        HttpResponse.json({
          userId: platformOrganizationActor.id,
          role: "platform_admin",
          scope: "global",
          mfaVerifiedAt: "2026-10-02T00:00:00.000Z",
        })
      ),
      http.post("*/api/auth/two-factor/verify-totp", () => {
        mfaConfirmed = true
        return HttpResponse.json({ status: true })
      }),
      transition("suspend"),
      transition("resume"),
    ],
  }
}
