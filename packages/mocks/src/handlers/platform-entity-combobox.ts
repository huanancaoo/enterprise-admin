import { delay, http, HttpResponse } from "msw"
import {
  PlatformOrganizationQuerySchema,
  PlatformUsersQuerySchema,
} from "@workspace/contracts"
import { platformOrganizationFixture } from "./platform-organizations"
import { platformUserFixture } from "./platform-users"

type DirectoryRequest = {
  q: string
  page: number
  pageSize: number
}

type DirectoryScenario =
  | "success"
  | "retryNextPage"
  | "badRequest"
  | "retryFirstPage"
  | "retrySelected"
  | "slowSearch"
  | "longText"
  | "unauthorized"
  | "forbidden"

// 记录真实页面请求，供故事区分目录草稿读取与日志筛选提交。
export function createPlatformEntityComboboxScenario(
  scenario: DirectoryScenario = "success"
) {
  const organizations = Array.from({ length: 25 }, (_, index) => ({
    ...structuredClone(platformOrganizationFixture),
    id: `c7dd0a27-4f8a-4aef-8d4c-${String(index + 1).padStart(12, "0")}`,
    name:
      index === 0
        ? scenario === "longText"
          ? "International research and compliance workspace ".repeat(12)
          : "North workspace"
        : index === 1
          ? "South workspace"
          : `Operations workspace ${String(index + 1).padStart(2, "0")}`,
    slug: index === 0 ? "north-workspace" : `workspace-${index + 1}`,
    status: index === 0 ? ("ACTIVE" as const) : ("SUSPENDED" as const),
  }))
  const users = Array.from({ length: 25 }, (_, index) => ({
    ...structuredClone(platformUserFixture),
    userId: `c7dd0a27-4f8a-4aef-8d4c-${String(index + 1001).padStart(12, "0")}`,
    name:
      index < 2
        ? scenario === "longText"
          ? "International research and compliance member ".repeat(12)
          : "Mina Chen"
        : `Directory member ${String(index + 1).padStart(2, "0")}`,
    maskedEmail: index < 2 ? "m***@example.test" : `d${index}***@example.test`,
  }))
  const requests = {
    organizations: [] as DirectoryRequest[],
    users: [] as DirectoryRequest[],
    organizationDetails: [] as string[],
    userDetails: [] as string[],
    audit: [] as Record<string, string>[],
    sensitiveProfiles: 0,
  }
  let nextPageFailed = false
  let firstPageFailed = false
  let selectedFailed = false
  const failure = (status: number, code: string) =>
    HttpResponse.json(
      { code, message: code, locale: "en-US", requestId: "storybook-combobox" },
      { status }
    )
  const reject = () => {
    if (scenario === "unauthorized") return failure(401, "UNAUTHENTICATED")
    if (scenario === "forbidden") return failure(403, "FORBIDDEN")
  }
  return {
    requests,
    organizations,
    users,
    reset: () => {
      requests.organizations.length = 0
      requests.users.length = 0
      requests.organizationDetails.length = 0
      requests.userDetails.length = 0
      requests.audit.length = 0
      requests.sensitiveProfiles = 0
      nextPageFailed = false
      firstPageFailed = false
      selectedFailed = false
    },
    handlers: [
      http.get("*/api/v1/platform/audit-events", ({ request }) => {
        requests.audit.push(
          Object.fromEntries(new URL(request.url).searchParams)
        )
        // 留给日志场景处理响应，这里只观察提交的筛选参数。
      }),
      http.get("*/api/v1/platform/organizations", async ({ request }) => {
        const query = PlatformOrganizationQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams)
        )
        const entry = {
          q: query.q ?? "",
          page: query.page,
          pageSize: query.pageSize,
        }
        requests.organizations.push(entry)
        const rejected = reject()
        if (rejected) return rejected
        if (scenario === "badRequest") return failure(400, "INVALID_QUERY")
        if (scenario === "retryFirstPage" && !firstPageFailed) {
          firstPageFailed = true
          return failure(503, "AUDIT_UNAVAILABLE")
        }
        if (scenario === "slowSearch" && query.q === "North") await delay(800)
        if (
          scenario === "retryNextPage" &&
          query.page === 2 &&
          !nextPageFailed
        ) {
          nextPageFailed = true
          return failure(503, "AUDIT_UNAVAILABLE")
        }
        const matching = organizations.filter(
          (item) =>
            !query.q ||
            `${item.name} ${item.slug}`
              .toLowerCase()
              .includes(query.q.toLowerCase())
        )
        return HttpResponse.json({
          items: matching
            .slice(
              (query.page - 1) * query.pageSize,
              query.page * query.pageSize
            )
            .map(
              ({
                id,
                name,
                slug,
                status,
                createdAt,
                memberCount,
                version,
              }) => ({
                id,
                name,
                slug,
                status,
                createdAt,
                memberCount,
                version,
              })
            ),
          total: matching.length,
          page: query.page,
          pageSize: query.pageSize,
        })
      }),
      http.get(
        "*/api/v1/platform/organizations/:organizationId",
        ({ params }) => {
          requests.organizationDetails.push(String(params.organizationId))
          if (scenario === "retrySelected" && !selectedFailed) {
            selectedFailed = true
            return failure(503, "AUDIT_UNAVAILABLE")
          }
          const rejected = reject()
          if (rejected) return rejected
          const item = organizations.find(
            (candidate) => candidate.id === params.organizationId
          )
          return item ? HttpResponse.json(item) : failure(404, "NOT_FOUND")
        }
      ),
      http.get("*/api/v1/platform/users", ({ request }) => {
        const query = PlatformUsersQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams)
        )
        const entry = {
          q: query.q ?? "",
          page: query.page,
          pageSize: query.pageSize,
        }
        requests.users.push(entry)
        const rejected = reject()
        if (rejected) return rejected
        const matching = users.filter(
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
            .map(
              ({
                userId,
                name,
                maskedEmail,
                emailVerified,
                lockedUntil,
                createdAt,
                organizationCount,
                status,
                version,
              }) => ({
                userId,
                name,
                maskedEmail,
                emailVerified,
                lockedUntil,
                createdAt,
                organizationCount,
                status,
                version,
              })
            ),
          total: matching.length,
          page: query.page,
          pageSize: query.pageSize,
        })
      }),
      http.get("*/api/v1/platform/users/:userId", ({ params }) => {
        requests.userDetails.push(String(params.userId))
        const rejected = reject()
        if (rejected) return rejected
        const item = users.find(
          (candidate) => candidate.userId === params.userId
        )
        return item ? HttpResponse.json(item) : failure(404, "NOT_FOUND")
      }),
      http.get("*/api/v1/platform/users/:userId/sensitive-profile", () => {
        requests.sensitiveProfiles += 1
        return failure(403, "FORBIDDEN")
      }),
    ],
  }
}
