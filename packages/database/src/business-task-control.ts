import type { Pool } from "pg"

export type BusinessTaskScope = {
  id: string
  organization_id: string
  actor_id: string
  type:
    | "projects.import"
    | "projects.export"
    | "members.export"
    | "audit.export"
    | "invitations.import"
  locale: "zh-CN" | "en-US" | "ar"
  request_id: string
  intent_fingerprint: string
}
export async function pendingBusinessTaskScopes(
  pool: Pick<Pool, "query">,
  after: string | null
) {
  const result = await pool.query<BusinessTaskScope>(
    "SELECT * FROM public.pending_business_task_scopes($1::uuid)",
    [after]
  )
  return result.rows
}
export async function recordBusinessTaskAttempt(
  pool: Pick<Pool, "query">,
  task: {
    organizationId: string
    actorId: string
    resourceId: string
    intentFingerprint: string
  },
  status: "queued" | "running" | "failed" | "rejected",
  code: string | null
) {
  await pool.query(
    "SELECT public.record_business_task_attempt($1::uuid,$2::uuid,$3::uuid,$4,$5,$6)",
    [
      task.organizationId,
      task.actorId,
      task.resourceId,
      task.intentFingerprint,
      status,
      code,
    ]
  )
}
