import { sql } from "drizzle-orm"
import type { TenantTx } from "./tenant.ts"

export class TenantActorError extends Error {
  constructor(readonly code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(code)
    this.name = "TenantActorError"
  }
}

export async function requireCurrentTenantActor(
  tx: TenantTx,
  sessionId: string | { credentialId: string }
): Promise<Date> {
  if (typeof sessionId !== "string")
    return requireCredentialActor(tx, sessionId.credentialId)
  const active = await tx.execute<{ valid: boolean }>(sql`
    WITH locked_session AS MATERIALIZED (
      SELECT expires_at FROM public.session
      WHERE id = ${sessionId}::uuid AND user_id = ${tx.context.userId}::uuid
      FOR SHARE
    )
    SELECT expires_at > (clock_timestamp() AT TIME ZONE 'UTC') AS valid FROM locked_session
  `)
  if (!active.rows[0]?.valid) throw new TenantActorError("UNAUTHENTICATED")
  await tx.execute(
    sql`SELECT public.require_active_organization(${tx.context.organizationId}::uuid)`
  )
  const membership = await tx.execute(sql`
    SELECT id FROM public.member
    WHERE id = ${tx.context.membershipId}::uuid
      AND organization_id = ${tx.context.organizationId}::uuid
      AND user_id = ${tx.context.userId}::uuid
    FOR SHARE
  `)
  if (!membership.rows[0]) throw new TenantActorError("FORBIDDEN")
  // 等待 status/member 可能跨过到期时间；同一数据库时钟同时判断身份并供 lease 使用。
  const current = await tx.execute<{ now: string; valid: boolean }>(sql`
    WITH current_clock AS MATERIALIZED (SELECT clock_timestamp() AS now)
    SELECT current_clock.now, active_session.expires_at > (current_clock.now AT TIME ZONE 'UTC') AS valid
    FROM current_clock, public.session AS active_session
    WHERE active_session.id = ${sessionId}::uuid
      AND active_session.user_id = ${tx.context.userId}::uuid
  `)
  if (!current.rows[0]?.valid) throw new TenantActorError("UNAUTHENTICATED")
  return new Date(current.rows[0].now)
}
async function requireCredentialActor(
  tx: TenantTx,
  credentialId: string
): Promise<Date> {
  const active = await tx.execute<{ valid: boolean }>(sql`
    WITH locked_key AS MATERIALIZED (
      SELECT k.enabled,k.expires_at FROM public.apikey k
      JOIN public.access_credentials c ON c.api_key_id=k.id
      WHERE k.id=${credentialId}::uuid AND k.reference_id=${tx.context.userId}
        AND c.organization_id=${tx.context.organizationId}::uuid FOR SHARE OF k
    ) SELECT enabled AND expires_at > (clock_timestamp() AT TIME ZONE 'UTC') AS valid FROM locked_key
  `)
  if (!active.rows[0]?.valid) throw new TenantActorError("UNAUTHENTICATED")
  await tx.execute(
    sql`SELECT public.require_active_organization(${tx.context.organizationId}::uuid)`
  )
  const membership = await tx.execute(sql`
    SELECT id FROM public.member WHERE id=${tx.context.membershipId}::uuid
      AND organization_id=${tx.context.organizationId}::uuid AND user_id=${tx.context.userId}::uuid FOR SHARE
  `)
  if (!membership.rows[0]) throw new TenantActorError("FORBIDDEN")
  // 凭据没有 Session；启停/到期直接以原生 key 行为准，不能合成浏览器身份。
  const current = await tx.execute<{ now: string; valid: boolean }>(sql`
    WITH current_clock AS MATERIALIZED (SELECT clock_timestamp() AS now)
    SELECT current_clock.now,k.enabled AND k.expires_at > (current_clock.now AT TIME ZONE 'UTC') AS valid
    FROM current_clock,public.apikey k WHERE k.id=${credentialId}::uuid AND k.reference_id=${tx.context.userId}
  `)
  if (!current.rows[0]?.valid) throw new TenantActorError("UNAUTHENTICATED")
  return new Date(current.rows[0].now)
}
