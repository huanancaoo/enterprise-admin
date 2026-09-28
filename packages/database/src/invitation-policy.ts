import { APIError } from "better-auth/api"
import type { QueryExecutor } from "./organization-status.ts"

export type InvitationLimits = {
  organization: number
  actor: number
  ip: number
}
export const defaultInvitationLimits: InvitationLimits = {
  organization: 100,
  actor: 50,
  ip: 100,
}

export function invitationError(
  code: string,
  status:
    | "BAD_REQUEST"
    | "FORBIDDEN"
    | "CONFLICT"
    | "TOO_MANY_REQUESTS" = "BAD_REQUEST"
): never {
  throw new APIError(status, { code, message: code })
}

export async function readInvitationPermission(
  db: QueryExecutor,
  organizationId: string,
  userId: string,
  action: "create" | "cancel" | "read"
) {
  const result = await db.query<{ role: string; permission: string | null }>(
    `SELECT m.role, r.permission FROM member m
     LEFT JOIN organization_role r ON r.organization_id = m.organization_id AND r.role = m.role
     WHERE m.organization_id = $1 AND m.user_id = $2`,
    [organizationId, userId]
  )
  const actor = result.rows[0]
  if (actor?.role === "owner" || actor?.role === "admin") return actor.role
  const actions = JSON.parse(actor?.permission ?? "{}").invitation as
    string[] | undefined
  // 目录属于邀请管理能力；成员目录权限不包含邮箱邀请名单。
  if (
    !actor ||
    !(action === "read"
      ? actions?.some((value) => value === "create" || value === "cancel")
      : actions?.includes(action))
  )
    return undefined
  return actor.role
}

export async function assertInvitationPermission(
  db: QueryExecutor,
  organizationId: string,
  userId: string,
  action: "create" | "cancel" | "read"
) {
  const role = await readInvitationPermission(
    db,
    organizationId,
    userId,
    action
  )
  if (!role) invitationError("FORBIDDEN", "FORBIDDEN")
  return role
}

export async function assertInvitationRole(
  db: QueryExecutor,
  organizationId: string,
  actorId: string,
  role: unknown
) {
  const actorRole = await assertInvitationPermission(
    db,
    organizationId,
    actorId,
    "create"
  )
  if (
    typeof role !== "string" ||
    role.includes(",") ||
    role !== role.trim() ||
    !role
  )
    invitationError("SINGLE_ROLE_REQUIRED")
  if (role === "owner" || (role === "admin" && actorRole !== "owner"))
    invitationError("INVITATION_ROLE_FORBIDDEN", "FORBIDDEN")
  if (role === "member" || role === "admin") return
  const exists = await db.query(
    "SELECT 1 FROM organization_role WHERE organization_id = $1 AND role = $2",
    [organizationId, role]
  )
  if (!exists.rowCount) invitationError("ROLE_NOT_FOUND")
}

export type InvitationRecord = {
  id: string
  email: string
  role: string
  status: string
  organization_id: string
  inviter_id: string
  expires_at: Date
  created_at: Date
}

export async function lockInvitation(
  db: QueryExecutor,
  id: string,
  recipient: boolean
) {
  const target = await db.query<{ organization_id: string }>(
    "SELECT organization_id FROM invitation WHERE id::text = $1",
    [id]
  )
  if (!target.rows[0])
    invitationError(
      recipient ? "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION" : "FORBIDDEN",
      "FORBIDDEN"
    )
  // 与成员、角色及组织状态变更共用组织锁，等待后再读取邀请和授权。
  await db.query(
    "SELECT organization_id FROM organization_status WHERE organization_id = $1 FOR UPDATE",
    [target.rows[0].organization_id]
  )
  const result = await db.query<InvitationRecord>(
    `SELECT *, expires_at AT TIME ZONE 'UTC' AS expires_at, created_at AT TIME ZONE 'UTC' AS created_at FROM invitation WHERE id::text = $1 FOR UPDATE`,
    [id]
  )
  return result.rows[0]
}

export function assertInvitationActive(invitation: InvitationRecord) {
  if (invitation.status !== "pending" || invitation.expires_at <= new Date())
    invitationError("INVITATION_NOT_ACTIVE", "CONFLICT")
}

export async function assertInvitationRecipient(
  db: QueryExecutor,
  actorId: string,
  email: string
) {
  const result = await db.query<{ email: string; email_verified: boolean }>(
    'SELECT email, email_verified FROM public."user" WHERE id::text = $1',
    [actorId]
  )
  const actor = result.rows[0]
  if (actor?.email.toLowerCase() !== email.toLowerCase())
    invitationError("YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION", "FORBIDDEN")
  if (!actor.email_verified)
    invitationError(
      "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
      "FORBIDDEN"
    )
}

export async function reserveInvitationSend(
  db: QueryExecutor,
  input: {
    organizationId: string
    actorId: string
    email: string
    ipHash: string
    limits: InvitationLimits
  }
) {
  // 不同组织也共享操作者/IP 配额；固定锁序避免跨组织并发超额或死锁。
  for (const key of [
    `invitation:actor:${input.actorId}`,
    `invitation:ip:${input.ipHash}`,
  ].sort()) {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      key,
    ])
  }
  const counts = await db.query<{
    email: number
    organization: number
    actor: number
    ip: number
  }>(
    `SELECT count(*) FILTER (WHERE organization_id = $1 AND email = $2)::int AS email,
            count(*) FILTER (WHERE organization_id = $1)::int AS organization,
            count(*) FILTER (WHERE actor_id = $3)::int AS actor,
            count(*) FILTER (WHERE ip_hash = $4)::int AS ip
     FROM invitation_send_events WHERE created_at > clock_timestamp() - interval '1 hour'`,
    [input.organizationId, input.email, input.actorId, input.ipHash]
  )
  const count = counts.rows[0]
  if (
    count.email >= 5 ||
    count.organization >= input.limits.organization ||
    count.actor >= input.limits.actor ||
    count.ip >= input.limits.ip
  )
    invitationError("INVITATION_RATE_LIMITED", "TOO_MANY_REQUESTS")
  await db.query(
    "INSERT INTO invitation_send_events (organization_id, email, actor_id, ip_hash) VALUES ($1, $2, $3, $4)",
    [input.organizationId, input.email, input.actorId, input.ipHash]
  )
}
