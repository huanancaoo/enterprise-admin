import { delay, http, HttpResponse } from "msw"
import { organizations } from "../fixtures/projects"

export type InvitationsScenario =
  | "success"
  | "permissionLoading"
  | "permissionUnavailable"
  | "loading"
  | "empty"
  | "unavailable"
  | "forbidden"
  | "unauthorized"
  | "slow"
  | "longText"
  | "terminal"
  | "member"
  | "admin"
  | "delegated"
  | "createOnly"
  | "cancelOnly"
  | "rolesLoading"
  | "rolesUnavailable"
  | "saveLoading"
  | "saveUnavailable"
  | "rateLimited"
  | "saveForbidden"
  | "saveUnauthorized"
  | "alreadyPending"
  | "alreadyMember"
  | "failedDelivery"
  | "unknownDelivery"
  | "pendingDelivery"
  | "unrecordedDelivery"
  | "readBackUnavailable"
  | "cancelLoading"
  | "cancelUnavailable"
  | "cancelForbidden"
  | "cancelUnauthorized"

type Invitation = {
  id: string
  email: string
  role: string
  status: string
  businessStatus: "pending" | "accepted" | "rejected" | "canceled" | "expired"
  inviterName: string
  createdAt: string
  expiresAt: string
  delivery: {
    attemptId: string
    status: "pending" | "smtp_accepted" | "failed" | "unknown"
    attemptedAt: string
    errorCode: string | null
  } | null
}
export const longInvitationEmail = `${"collaboration-team-"}${"a".repeat(40)}@${"international-office.".repeat(5)}example.test`

export function createInvitationsScenario(
  scenario: InvitationsScenario = "success"
) {
  const organizationId = organizations[0].id
  const actorRole =
    scenario === "admin"
      ? "admin"
      : scenario === "member"
        ? "member"
        : ["delegated", "createOnly", "cancelOnly"].includes(scenario)
          ? "team-manager"
          : "owner"
  const createdAt = new Date(Date.now() - 86_400_000).toISOString()
  const expiresAt = new Date(Date.now() + 6 * 86_400_000).toISOString()
  const base: Invitation[] = [
    ["casey@example.test", "member"],
    ["devon@example.test", "project-editor"],
    ["blair@example.test", "admin"],
  ].map(([email, role], index) => ({
    id: `c7dd0a27-4f8a-4aef-8d4c-${String(7101 + index).padStart(12, "0")}`,
    email: email!,
    role: role!,
    status: "pending",
    businessStatus: "pending",
    inviterName: "Morgan Owner",
    createdAt,
    expiresAt,
    delivery: {
      attemptId: `invitation-attempt-${index}`,
      status: "smtp_accepted",
      attemptedAt: createdAt,
      errorCode: null,
    },
  }))
  if (scenario === "longText") {
    base[0]!.email = longInvitationEmail
    base[0]!.inviterName = "International collaboration team ".repeat(7).trim()
  }
  if (scenario === "terminal") {
    base.length = 0
    for (const [index, status] of (
      ["accepted", "rejected", "canceled", "expired"] as const
    ).entries())
      base.push({
        id: `c7dd0a27-4f8a-4aef-8d4c-${String(7101 + index).padStart(12, "0")}`,
        email: `${status}@example.test`,
        role: "member",
        status: status === "expired" ? "pending" : status,
        businessStatus: status,
        inviterName: "Morgan Owner",
        createdAt:
          status === "expired"
            ? new Date(Date.now() - 8 * 86_400_000).toISOString()
            : createdAt,
        expiresAt:
          status === "expired"
            ? new Date(Date.now() - 86_400_000).toISOString()
            : expiresAt,
        delivery: null,
      })
  }
  let rows = structuredClone(scenario === "empty" ? [] : base)
  let wrote = false
  let failedOnce = false
  let revoked = false
  let attempt = 1
  const failure = (status: number, code: string, message: string) =>
    HttpResponse.json({ code, message }, { status })
  const delivery = (): Invitation["delivery"] =>
    scenario === "unrecordedDelivery"
      ? null
      : {
          attemptId: `invitation-attempt-${++attempt}`,
          status:
            scenario === "failedDelivery"
              ? "failed"
              : scenario === "unknownDelivery"
                ? "unknown"
                : scenario === "pendingDelivery"
                  ? "pending"
                  : "smtp_accepted",
          attemptedAt: new Date().toISOString(),
          errorCode: scenario === "failedDelivery" ? "SMTP_REJECTED" : null,
        }
  return {
    actorRole,
    // 生命周期与投递分开保存，重发保持原邀请 ID、角色及有效期。
    reset: () => {
      rows = structuredClone(scenario === "empty" ? [] : base)
      wrote = false
      failedOnce = false
      revoked = false
      attempt = 1
    },
    handlers: [
      http.post(
        "*/api/auth/organization/has-permission",
        async ({ request }) => {
          if (scenario === "permissionLoading") await delay("infinite")
          if (scenario === "permissionUnavailable")
            return failure(
              503,
              "INTERNAL_ERROR",
              "Invitation permissions unavailable"
            )
          await delay(80)
          const input = (await request.json()) as {
            organizationId: string
            permissions: { invitation: ("create" | "cancel")[] }
          }
          return HttpResponse.json({
            success:
              !revoked &&
              actorRole !== "member" &&
              input.organizationId === organizationId &&
              input.permissions.invitation.every(
                (action) =>
                  (action === "create" && scenario !== "cancelOnly") ||
                  (action === "cancel" && scenario !== "createOnly")
              ),
          })
        }
      ),
      http.get(
        "*/api/auth/organization/list-invitations",
        async ({ request }) => {
          if (
            new URL(request.url).searchParams.get("organizationId") !==
            organizationId
          )
            return failure(403, "FORBIDDEN", "Access denied")
          if (scenario === "loading") await delay("infinite")
          if (scenario === "slow") await delay(700)
          if (scenario === "forbidden") {
            await delay(300)
            revoked = true
            return failure(403, "FORBIDDEN", "Access denied")
          }
          if (scenario === "unauthorized")
            return failure(401, "UNAUTHENTICATED", "Authentication required")
          if (
            scenario === "unavailable" ||
            (scenario === "readBackUnavailable" && wrote)
          )
            return failure(
              503,
              "INTERNAL_ERROR",
              "Invitation directory unavailable"
            )
          return HttpResponse.json(rows)
        }
      ),
      http.get("*/api/auth/organization/list-roles", async () => {
        if (scenario === "rolesLoading") await delay("infinite")
        if (scenario === "rolesUnavailable")
          return failure(503, "INTERNAL_ERROR", "Role directory unavailable")
        if (actorRole !== "owner" && actorRole !== "admin")
          return failure(403, "FORBIDDEN", "Access denied")
        return HttpResponse.json([
          {
            id: "c7dd0a27-4f8a-4aef-8d4c-000000007201",
            organizationId,
            role: "project-editor",
            permission: { project: ["read", "update"] },
            createdAt,
            memberCount: 0,
            invitationCount: rows.filter(
              (row) =>
                row.role === "project-editor" &&
                row.businessStatus === "pending"
            ).length,
            authorizationVersion: 3,
          },
        ])
      }),
      http.get("*/api/v1/organizations/:organizationId/access", () =>
        HttpResponse.json({
          organizationId,
          status: "ACTIVE",
          authorizationVersion: 3,
          effectiveLocale: "en-US",
          effectiveLocaleSource: "platform",
        })
      ),
      http.post(
        "*/api/auth/organization/invite-member",
        async ({ request }) => {
          const input = (await request.json()) as {
            organizationId: string
            email: string
            role: string
            resend?: boolean
          }
          if (scenario === "saveLoading") await delay("infinite")
          if (scenario === "saveForbidden")
            return failure(403, "FORBIDDEN", "Invitation permission denied")
          if (scenario === "saveUnauthorized")
            return failure(401, "UNAUTHENTICATED", "Authentication required")
          if (scenario === "alreadyPending")
            return failure(
              409,
              "INVITATION_ALREADY_PENDING",
              "This email has an active invitation. Resend the existing invitation."
            )
          if (scenario === "alreadyMember")
            return failure(
              409,
              "MEMBER_ALREADY_EXISTS",
              "This email is already an organization member."
            )
          if (
            !failedOnce &&
            ["saveUnavailable", "rateLimited"].includes(scenario)
          ) {
            failedOnce = true
            return failure(
              scenario === "rateLimited" ? 429 : 503,
              scenario === "rateLimited"
                ? input.resend
                  ? "INVITATION_RESEND_COOLDOWN"
                  : "INVITATION_RATE_LIMITED"
                : "INTERNAL_ERROR",
              scenario === "rateLimited"
                ? input.resend
                  ? "Wait 60 seconds before resending."
                  : "Invitation send limit reached."
                : "Invitation request unavailable"
            )
          }
          await delay(400)
          let row: Invitation
          if (input.resend) {
            row = rows.find((current) => current.email === input.email)!
          } else {
            row = {
              id: "c7dd0a27-4f8a-4aef-8d4c-000000007199",
              email: input.email,
              role: input.role,
              status: "pending",
              businessStatus: "pending",
              inviterName: "Morgan Owner",
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
              delivery: null,
            }
            rows.push(row)
          }
          row.delivery = delivery()
          wrote = true
          return HttpResponse.json(row)
        }
      ),
      http.post(
        "*/api/auth/organization/cancel-invitation",
        async ({ request }) => {
          const input = (await request.json()) as { invitationId: string }
          if (scenario === "cancelLoading") await delay("infinite")
          if (scenario === "cancelForbidden")
            return failure(403, "FORBIDDEN", "Invitation permission denied")
          if (scenario === "cancelUnauthorized")
            return failure(401, "UNAUTHENTICATED", "Authentication required")
          if (scenario === "cancelUnavailable" && !failedOnce) {
            failedOnce = true
            return failure(503, "INTERNAL_ERROR", "Cancellation unavailable")
          }
          await delay(400)
          const row = rows.find((current) => current.id === input.invitationId)!
          row.status = "canceled"
          row.businessStatus = "canceled"
          return HttpResponse.json(row)
        }
      ),
    ],
  }
}
