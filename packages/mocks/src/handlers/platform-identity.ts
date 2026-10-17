import { delay, http, HttpResponse } from "msw"
import {
  LoginLogsQuerySchema,
  PersonalLoginLogsQuerySchema,
  PlatformSessionsQuerySchema,
  type LoginLog,
  type PlatformSession,
} from "@workspace/contracts/identity-management"

const userId = "c7dd0a27-4f8a-4aef-8d4c-000000001001"
const loginEvents: LoginLog[] = Array.from({ length: 25 }, (_, index) => ({
  id: `c7dd0a27-4f8a-4aef-8d4c-${String(index + 2001).padStart(12, "0")}`,
  userId: index === 0 ? null : userId,
  name: index === 0 ? null : "Platform Operator",
  maskedEmail: index === 0 ? null : "o***@example.test",
  occurredAt: new Date(Date.now() - index * 60_000).toISOString(),
  method: index % 3 === 0 ? "github" : index % 3 === 1 ? "email" : "totp",
  result: index % 4 === 0 ? "failed" : "succeeded",
  reasonCode: index % 4 === 0 ? "INVALID_CREDENTIALS" : null,
  ipAddress: index % 2 === 0 ? "192.0.2.12" : "2001:db8::12",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
}))

const sessions: PlatformSession[] = Array.from({ length: 3 }, (_, index) => ({
  sessionId: `c7dd0a27-4f8a-4aef-8d4c-${String(index + 3001).padStart(12, "0")}`,
  userId,
  name: "Platform Operator",
  maskedEmail: "o***@example.test",
  createdAt: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
  updatedAt: new Date(Date.now() - index * 60_000).toISOString(),
  expiresAt: new Date(Date.now() + (index + 1) * 86_400_000).toISOString(),
  ipAddress: "192.0.2.12",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
}))

export type PlatformIdentityScenario =
  | "success"
  | "loading"
  | "empty"
  | "forbidden"
  | "unavailable"
  | "revokeSlow"
  | "revokeFailure"

export function createPlatformIdentityScenario(
  scenario: PlatformIdentityScenario = "success"
) {
  const revokedSessionIds: string[] = []
  const personalLoginQueries: URLSearchParams[] = []
  const loginQueries: URLSearchParams[] = []
  const sessionQueries: URLSearchParams[] = []
  const failure = async () => {
    if (scenario === "loading") await delay("infinite")
    if (scenario === "forbidden")
      return HttpResponse.json(
        {
          code: "FORBIDDEN",
          message: "FORBIDDEN",
          locale: "en-US",
          requestId: "storybook-identity",
        },
        { status: 403 }
      )
    if (scenario === "unavailable")
      return HttpResponse.json(
        {
          code: "SERVICE_UNAVAILABLE",
          message: "SERVICE_UNAVAILABLE",
          locale: "en-US",
          requestId: "storybook-identity",
        },
        { status: 503 }
      )
  }
  const makePage = <T>(
    items: T[],
    page: number,
    pageSize: number,
    total: number
  ) => ({
    items,
    total,
    page,
    pageSize,
  })
  return {
    revokedSessionIds,
    personalLoginQueries,
    loginQueries,
    sessionQueries,
    reset: () => {
      revokedSessionIds.splice(0)
      personalLoginQueries.splice(0)
      loginQueries.splice(0)
      sessionQueries.splice(0)
    },
    handlers: [
      http.get("*/api/v1/platform/login-events", async ({ request }) => {
        const rejected = await failure()
        if (rejected) return rejected
        loginQueries.push(new URL(request.url).searchParams)
        const query = LoginLogsQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams)
        )
        const matching = (scenario === "empty" ? [] : loginEvents).filter(
          (item) =>
            (!query.userId || item.userId === query.userId) &&
            (!query.method || item.method === query.method) &&
            (!query.result || item.result === query.result) &&
            (!query.from ||
              Date.parse(item.occurredAt) >= Date.parse(query.from)) &&
            (!query.to ||
              Date.parse(item.occurredAt) <= Date.parse(query.to)) &&
            (!query.q ||
              `${item.name ?? ""} ${item.maskedEmail ?? ""} ${item.ipAddress ?? ""}`
                .toLowerCase()
                .includes(query.q.toLowerCase()))
        )
        const offset = (query.page - 1) * query.pageSize
        return HttpResponse.json(
          makePage(
            matching.slice(offset, offset + query.pageSize),
            query.page,
            query.pageSize,
            matching.length
          )
        )
      }),
      http.get("*/api/v1/me/login-events", async ({ request }) => {
        const rejected = await failure()
        if (rejected) return rejected
        personalLoginQueries.push(new URL(request.url).searchParams)
        const query = PersonalLoginLogsQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams)
        )
        const matching = (scenario === "empty" ? [] : loginEvents).filter(
          (item) =>
            (!query.method || item.method === query.method) &&
            (!query.result || item.result === query.result) &&
            (!query.from ||
              Date.parse(item.occurredAt) >= Date.parse(query.from)) &&
            (!query.to || Date.parse(item.occurredAt) <= Date.parse(query.to))
        )
        const offset = (query.page - 1) * query.pageSize
        return HttpResponse.json(
          makePage(
            matching.slice(offset, offset + query.pageSize),
            query.page,
            query.pageSize,
            matching.length
          )
        )
      }),
      http.get("*/api/v1/platform/sessions", async ({ request }) => {
        const rejected = await failure()
        if (rejected) return rejected
        sessionQueries.push(new URL(request.url).searchParams)
        const query = PlatformSessionsQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams)
        )
        const matching = (scenario === "empty" ? [] : sessions).filter(
          (item) =>
            (!query.userId || item.userId === query.userId) &&
            (!query.q ||
              `${item.name} ${item.maskedEmail} ${item.ipAddress ?? ""}`
                .toLowerCase()
                .includes(query.q.toLowerCase())) &&
            !revokedSessionIds.includes(item.sessionId)
        )
        const offset = (query.page - 1) * query.pageSize
        return HttpResponse.json(
          makePage(
            matching.slice(offset, offset + query.pageSize),
            query.page,
            query.pageSize,
            matching.length
          )
        )
      }),
      http.delete(
        "*/api/v1/platform/sessions/:sessionId",
        async ({ params }) => {
          if (scenario === "revokeSlow") await delay("infinite")
          if (scenario === "revokeFailure")
            return HttpResponse.json(
              {
                code: "SESSION_REVOKE_FAILED",
                message: "SESSION_REVOKE_FAILED",
                locale: "en-US",
                requestId: "storybook-identity",
              },
              { status: 503 }
            )
          revokedSessionIds.push(String(params.sessionId))
          return HttpResponse.json({
            sessionId: params.sessionId,
            revoked: true,
          })
        }
      ),
    ],
  }
}
