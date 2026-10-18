import type { DBAdapter } from "better-auth"
import { APIError } from "better-auth/api"
import { organization } from "better-auth/plugins"
import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import type { QueryResult, QueryResultRow } from "pg"
import * as schema from "./schema/auth.ts"
import type { QueryExecutor } from "./organization-status.ts"
import type { TenantTx } from "./tenant.ts"
import {
  assertInvitationRole,
  defaultInvitationLimits,
  invitationError,
  reserveInvitationSend,
  type InvitationLimits,
} from "./invitation-policy.ts"

export const ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60
export const ORGANIZATION_PENDING_INVITATION_LIMIT = 100
export type NativeInvitation = {
  id: string
  email: string
  role: string
  status: string
  organizationId: string
  inviterId: string
  expiresAt: Date
  createdAt: Date
}
export type InvitationDeliveryIntent = {
  attemptId: string
  actorId: string
  requestId: string
}
export type InvitationCommandInput = {
  organizationId: string
  actorId: string
  requestId: string
  email: string
  role: string
  ipHash: string
  limits?: InvitationLimits
}

// 调用者提供同一事务的原生创建 adapter；邀请、配额、触发器审计和投递意图必须共同提交。
export async function createOrganizationInvitation(
  db: QueryExecutor,
  create: (data: Omit<NativeInvitation, "id">) => Promise<NativeInvitation>,
  input: InvitationCommandInput
): Promise<{
  invitation: NativeInvitation
  delivery: InvitationDeliveryIntent
}> {
  await db.query("SELECT public.require_active_account($1::uuid)", [
    input.actorId,
  ])
  await db.query("SELECT public.require_active_organization($1::uuid)", [
    input.organizationId,
  ])
  await assertInvitationRole(
    db,
    input.organizationId,
    input.actorId,
    input.role
  )
  const email = input.email.toLowerCase()
  if (!z.email().safeParse(email).success) invitationError("INVALID_EMAIL")
  const member = await db.query(
    `SELECT 1 FROM member m JOIN public."user" u ON u.id=m.user_id WHERE m.organization_id=$1 AND lower(u.email)=$2`,
    [input.organizationId, email]
  )
  if (member.rowCount) invitationError("MEMBER_ALREADY_EXISTS", "CONFLICT")
  const pending = await db.query(
    `SELECT 1 FROM invitation WHERE organization_id=$1 AND lower(email)=$2 AND status='pending' AND expires_at>clock_timestamp()`,
    [input.organizationId, email]
  )
  if (pending.rowCount)
    invitationError("INVITATION_ALREADY_PENDING", "CONFLICT")
  const count = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM invitation WHERE organization_id=$1 AND status='pending' AND expires_at>clock_timestamp()`,
    [input.organizationId]
  )
  if (count.rows[0].count >= ORGANIZATION_PENDING_INVITATION_LIMIT)
    invitationError("INVITATION_LIMIT_REACHED", "FORBIDDEN")
  await reserveInvitationSend(db, {
    ...input,
    email,
    limits: input.limits ?? defaultInvitationLimits,
  })
  await db.query(
    `SELECT set_config('app.auth_actor_id',$1,true),set_config('app.auth_request_id',$2,true),set_config('app.auth_organization_operation','/organization/invite-member',true),set_config('app.organization_id',$3,true)`,
    [input.actorId, input.requestId, input.organizationId]
  )
  const createdAt = new Date()
  const invitation = await create({
    email,
    role: input.role,
    status: "pending",
    organizationId: input.organizationId,
    inviterId: input.actorId,
    createdAt,
    expiresAt: new Date(
      createdAt.getTime() + ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS * 1000
    ),
  })
  const attempt = await db.query<{
    id: string
    actor_id: string
    request_id: string
  }>(
    "INSERT INTO invitation_delivery_attempts (invitation_id,organization_id,actor_id,request_id) VALUES ($1,$2,$3,$4) RETURNING id,actor_id,request_id",
    [invitation.id, input.organizationId, input.actorId, input.requestId]
  )
  return {
    invitation,
    delivery: {
      attemptId: attempt.rows[0].id,
      actorId: attempt.rows[0].actor_id,
      requestId: attempt.rows[0].request_id,
    },
  }
}

// 这里只编译服务端固定 SQL 的位置参数，值仍由 Drizzle 绑定，不把文件内容拼成 SQL。
export function invitationTenantExecutor(tx: TenantTx): QueryExecutor {
  return {
    async query<Row extends QueryResultRow>(
      text: string,
      values: unknown[] = []
    ): Promise<QueryResult<Row>> {
      const chunks: SQL[] = []
      const parts = text.split(/\$(\d+)/g)
      for (let index = 0; index < parts.length; index++)
        chunks.push(
          index % 2 === 0
            ? sql.raw(parts[index])
            : sql`${values[Number(parts[index]) - 1]}`
        )
      const result = await tx.execute<Row>(sql.join(chunks, sql.raw("")))
      return {
        ...result,
        command: "",
        oid: 0,
        fields: [],
        rowCount: result.rowCount ?? null,
      } as QueryResult<Row>
    },
  }
}

export function nativeInvitationCreator(tx: TenantTx) {
  const adapter: DBAdapter = drizzleAdapter(
    tx as Parameters<typeof drizzleAdapter>[0],
    { provider: "pg", schema, transaction: false }
  )({
    plugins: [
      organization({
        invitationExpiresIn: ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS,
      }),
    ],
    advanced: { database: { generateId: "uuid" } },
  })
  return (data: Omit<NativeInvitation, "id">) =>
    adapter.create<NativeInvitation>({ model: "invitation", data })
}

export function invitationFailureCode(error: unknown): string | undefined {
  const value = error as {
    body?: { code?: unknown }
    cause?: { code?: string }
    code?: string
  }
  if (error instanceof APIError && typeof value.body?.code === "string")
    return value.body.code
  const code = value.cause?.code ?? value.code
  if (code === "ORG05") return "INVITATION_ALREADY_PENDING"
  return undefined
}

export {
  readInvitationLimits,
  assertInvitationRole,
  defaultInvitationLimits,
} from "./invitation-policy.ts"
