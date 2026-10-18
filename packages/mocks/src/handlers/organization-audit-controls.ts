import { delay, http, HttpResponse } from "msw"
import {
  BusinessTaskSchema,
  CreateAuditExportSchema,
  OrganizationMemberOptionsPageSchema,
  OrganizationMemberOptionsQuerySchema,
  type CreateAuditExport,
  type OrganizationMemberOptionsQuery,
} from "@workspace/contracts"
import { organizations } from "../fixtures/projects"
import { organizationAuditFixture } from "./organization-audit"

export const organizationAuditUser = {
  id: organizationAuditFixture.actorId!,
  name: "Morgan Audit",
  email: "morgan.audit@example.test",
}
export const organizationAuditMembers = Array.from(
  { length: 25 },
  (_, index) => ({
    userId:
      index === 0
        ? organizationAuditUser.id
        : `c7dd0a27-4f8a-4aef-8d4c-${String(index + 7001).padStart(12, "0")}`,
    name:
      index === 0 ? organizationAuditUser.name : `Tenant Member ${index + 1}`,
  })
)
export const organizationAuditExportTask = BusinessTaskSchema.parse({
  id: "c7dd0a27-4f8a-4aef-8d4c-000000008001",
  organizationId: organizations[0].id,
  actorId: organizationAuditUser.id,
  type: "audit.export",
  status: "submitted",
  format: "xlsx",
  createdAt: "2026-10-18T00:00:00.000Z",
  updatedAt: "2026-10-18T00:00:00.000Z",
  errorCode: null,
  result: null,
  resultAvailable: false,
})

type MemberMode =
  | "success"
  | "empty"
  | "loading"
  | "slow"
  | "forbidden"
  | "unauthorized"
  | "unavailable"
  | "retryable"
type ExportMode = "success" | "forbidden" | "unavailable" | "retryable"

export function createOrganizationAuditControlsScenario(options?: {
  members?: MemberMode
  canExport?: boolean
  export?: ExportMode
}) {
  let memberFailed = false
  let exportFailed = false
  let revoked = false
  const memberRequests: Array<{
    organizationId: string
    query: OrganizationMemberOptionsQuery
  }> = []
  const exportRequests: Array<{
    organizationId: string
    body: CreateAuditExport
    idempotencyKey: string | null
  }> = []
  const failure = (status: number, code: string) =>
    HttpResponse.json(
      {
        code,
        message: code,
        requestId: "storybook-organization-audit-controls",
        locale: "en-US",
      },
      { status }
    )
  return {
    reset: () => {
      memberFailed = false
      exportFailed = false
      revoked = false
      memberRequests.length = 0
      exportRequests.length = 0
    },
    revoke: () => {
      revoked = true
    },
    memberRequests: () => structuredClone(memberRequests),
    exportRequests: () => structuredClone(exportRequests),
    handlers: [
      http.get("*/api/auth/get-session", () =>
        HttpResponse.json({
          user: {
            ...organizationAuditUser,
            emailVerified: true,
            createdAt: "2026-09-01T00:00:00.000Z",
            updatedAt: "2026-09-01T00:00:00.000Z",
          },
          session: {
            id: "organization-audit-session",
            token: "storybook-organization-audit",
            userId: organizationAuditUser.id,
            activeOrganizationId: organizations[0].id,
            expiresAt: "2099-01-01T00:00:00.000Z",
            createdAt: "2026-09-01T00:00:00.000Z",
            updatedAt: "2026-09-01T00:00:00.000Z",
          },
        })
      ),
      http.post(
        "*/api/auth/organization/has-permission",
        async ({ request }) => {
          const body = (await request.json()) as {
            organizationId: string
            permissions: Record<string, string[]>
          }
          return HttpResponse.json({
            success:
              !revoked &&
              body.organizationId === organizations[0].id &&
              options?.canExport === true &&
              Object.keys(body.permissions).length === 1 &&
              body.permissions.audit?.length === 1 &&
              body.permissions.audit[0] === "export",
            error: null,
          })
        }
      ),
      http.get(
        "*/api/v1/organizations/:organizationId/member-options",
        async ({ params, request }) => {
          const organizationId = String(params.organizationId)
          const query = OrganizationMemberOptionsQuerySchema.parse(
            Object.fromEntries(new URL(request.url).searchParams)
          )
          memberRequests.push({ organizationId, query })
          // 日志候选只投影当前组织成员姓名，不取得成员邮箱读取能力。
          if (
            organizationId !== organizations[0].id ||
            revoked ||
            options?.members === "forbidden"
          )
            return failure(403, "FORBIDDEN")
          if (options?.members === "unauthorized")
            return failure(401, "UNAUTHENTICATED")
          if (options?.members === "loading") await delay("infinite")
          if (options?.members === "slow") await delay(700)
          if (options?.members === "unavailable")
            return failure(503, "INTERNAL_ERROR")
          if (options?.members === "retryable" && !memberFailed) {
            memberFailed = true
            return failure(503, "INTERNAL_ERROR")
          }
          const q = query.q?.toLowerCase()
          const matching =
            options?.members === "empty"
              ? []
              : organizationAuditMembers.filter(
                  (item) =>
                    (!query.userId || item.userId === query.userId) &&
                    (!q || item.name.toLowerCase().includes(q))
                )
          const offset = (query.page - 1) * query.pageSize
          return HttpResponse.json(
            OrganizationMemberOptionsPageSchema.parse({
              items: matching.slice(offset, offset + query.pageSize),
              total: matching.length,
              page: query.page,
              pageSize: query.pageSize,
            })
          )
        }
      ),
      http.post(
        "*/api/v1/organizations/:organizationId/audit-events/exports",
        async ({ params, request }) => {
          const organizationId = String(params.organizationId)
          const body = CreateAuditExportSchema.parse(await request.json())
          exportRequests.push({
            organizationId,
            body,
            idempotencyKey: request.headers.get("Idempotency-Key"),
          })
          if (
            organizationId !== organizations[0].id ||
            !options?.canExport ||
            revoked ||
            options?.export === "forbidden"
          )
            return failure(403, "FORBIDDEN")
          if (options?.export === "unavailable")
            return failure(503, "INTERNAL_ERROR")
          if (options?.export === "retryable" && !exportFailed) {
            exportFailed = true
            return failure(503, "INTERNAL_ERROR")
          }
          return HttpResponse.json(organizationAuditExportTask, { status: 202 })
        }
      ),
    ],
  }
}
