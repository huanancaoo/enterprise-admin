import { delay, http, HttpResponse } from "msw"
import {
  PlatformUsersQuerySchema,
  SensitiveProfileQuerySchema,
  type PlatformUserDetail,
} from "@workspace/contracts"

export const platformUserFullEmail = "mina.chen@example.test"
export const platformUserFixture: PlatformUserDetail = {
  userId: "c7dd0a27-4f8a-4aef-8d4c-000000001001",
  name: "Mina Chen",
  maskedEmail: "m***@example.test",
  emailVerified: true,
  createdAt: "2026-09-16T00:00:00.000Z",
  organizationCount: 2,
  twoFactorEnabled: true,
  organizations: [
    {
      organizationId: "c7dd0a27-4f8a-4aef-8d4c-000000000001",
      name: "North workspace",
      slug: "north-workspace",
      status: "ACTIVE",
      role: "owner",
      joinedAt: "2026-09-16T00:00:00.000Z",
    },
    {
      organizationId: "c7dd0a27-4f8a-4aef-8d4c-000000000002",
      name: "South workspace",
      slug: "south-workspace",
      status: "SUSPENDED",
      role: "member",
      joinedAt: "2026-09-17T00:00:00.000Z",
    },
  ],
}

export type PlatformUsersScenario =
  | "success"
  | "loading"
  | "slow"
  | "empty"
  | "noMemberships"
  | "longText"
  | "unverified"
  | "unauthorized"
  | "forbidden"
  | "unavailable"
  | "notFound"
  | "paginated"
  | "sensitiveLoading"
  | "sensitiveFailure"
  | "sensitiveRateLimited"

export function createPlatformUsersScenario(
  scenario: PlatformUsersScenario = "success"
) {
  const user = structuredClone(platformUserFixture)
  if (scenario === "noMemberships") {
    user.organizations = []
    user.organizationCount = 0
  }
  if (scenario === "unverified") {
    user.emailVerified = false
    user.twoFactorEnabled = false
  }
  if (scenario === "longText") {
    user.name = "国际研发与合规协作成员 ".repeat(16)
    user.organizations[0].name = "国际研发与合规协作组织 ".repeat(16)
    user.organizations[0].slug = "international-research-compliance-".repeat(8)
  }
  const users: PlatformUserDetail[] = [
    user,
    ...Array.from(
      { length: scenario === "paginated" ? 24 : 1 },
      (_, index) => ({
        ...structuredClone(platformUserFixture),
        userId: `c7dd0a27-4f8a-4aef-8d4c-${String(index + 1002).padStart(12, "0")}`,
        name: index === 0 ? "Jo Park" : `Directory member ${index + 2}`,
        maskedEmail: `d${index + 2}***@example.test`,
        organizationCount: 0,
        organizations: [],
      })
    ),
  ]
  const privateEmails = new Map(
    users.map((item, index) => [
      item.userId,
      index === 0 ? platformUserFullEmail : `d${index + 1}.user@example.test`,
    ])
  )
  let sensitiveFailureReturned = false
  const failure = (status: number, code: string) =>
    HttpResponse.json(
      { code, message: code, locale: "en-US", requestId: "storybook-users" },
      { status }
    )
  const readFailure = async () => {
    if (scenario === "loading") await delay("infinite")
    if (scenario === "slow") await delay(700)
    if (scenario === "unauthorized") return failure(401, "UNAUTHENTICATED")
    if (scenario === "forbidden") return failure(403, "FORBIDDEN")
    if (scenario === "unavailable") return failure(503, "AUDIT_UNAVAILABLE")
  }
  return {
    reset: () => {
      sensitiveFailureReturned = false
    },
    handlers: [
      http.get("*/api/v1/platform/users", async ({ request }) => {
        const rejected = await readFailure()
        if (rejected) return rejected
        const query = PlatformUsersQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams)
        )
        const matching = (scenario === "empty" ? [] : users).filter(
          (item) =>
            !query.q ||
            `${item.userId} ${item.name} ${item.maskedEmail}`
              .toLowerCase()
              .includes(query.q.toLowerCase())
        )
        return HttpResponse.json({
          items: matching
            .slice(
              (query.page - 1) * query.pageSize,
              query.page * query.pageSize
            )
            .map((item) => ({
              userId: item.userId,
              name: item.name,
              maskedEmail: item.maskedEmail,
              emailVerified: item.emailVerified,
              createdAt: item.createdAt,
              organizationCount: item.organizationCount,
            })),
          page: query.page,
          pageSize: query.pageSize,
          total: matching.length,
        })
      }),
      http.get("*/api/v1/platform/users/:userId", async ({ params }) => {
        const rejected = await readFailure()
        if (rejected) return rejected
        if (scenario === "notFound") return failure(404, "NOT_FOUND")
        const result = users.find((item) => item.userId === params.userId)
        return result ? HttpResponse.json(result) : failure(404, "NOT_FOUND")
      }),
      http.get(
        "*/api/v1/platform/users/:userId/sensitive-profile",
        async ({ request, params }) => {
          SensitiveProfileQuerySchema.parse(
            Object.fromEntries(new URL(request.url).searchParams)
          )
          const target = users.find((item) => item.userId === params.userId)
          if (!target) return failure(404, "NOT_FOUND")
          if (scenario === "sensitiveLoading") await delay("infinite")
          if (
            !sensitiveFailureReturned &&
            (scenario === "sensitiveFailure" ||
              scenario === "sensitiveRateLimited")
          ) {
            sensitiveFailureReturned = true
            return failure(
              scenario === "sensitiveFailure" ? 503 : 429,
              "INTERNAL_ERROR"
            )
          }
          await delay(500)
          // 完整邮箱只出现在显式敏感读取；目录和详情始终使用脱敏投影。
          return HttpResponse.json({
            userId: target.userId,
            email: privateEmails.get(target.userId)!,
          })
        }
      ),
    ],
  }
}
