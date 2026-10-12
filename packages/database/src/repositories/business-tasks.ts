import { and, count, desc, eq, sql } from "drizzle-orm"
import { auditEvents } from "../schema/audit.ts"
import type { TenantTx } from "../tenant.ts"
import { businessTasks } from "../schema/business-capabilities.ts"
import { member } from "../schema/auth.ts"

export type NewBusinessTask = typeof businessTasks.$inferInsert
export const businessTaskRepository = {
  async center(tx: TenantTx, page: number, pageSize: number) {
    const all = await this.canReadOrganization(tx)
    type CenterRow = {
      id: string | null
      source: "business" | "file-upload" | "file-path" | "file-batch"
      type: string
      actorId: string
      status: string | null
      states: { state: string; count: number }[] | null
      createdAt: string
      updatedAt: string
      resultAvailable: boolean
      errorCode: string | null
      total: number
    }
    const result = await tx.execute<CenterRow>(sql`
      WITH visible AS (
        SELECT id::text, 'business'::text AS source, type, actor_id AS "actorId", status, NULL::jsonb AS states,
          created_at AS "createdAt", updated_at AS "updatedAt", result_content IS NOT NULL AS "resultAvailable", error_code AS "errorCode"
        FROM business_tasks WHERE organization_id=${tx.context.organizationId}::uuid AND (${all} OR actor_id=${tx.context.userId}::uuid)
        UNION ALL
        SELECT o.id::text, CASE WHEN o.action IN ('upload','overwrite') THEN 'file-upload' ELSE 'file-path' END,
          o.action, o.actor_id, o.phase, NULL::jsonb, o.created_at, o.updated_at, o.result IS NOT NULL, o.error_code
        FROM file_operations o WHERE o.organization_id=${tx.context.organizationId}::uuid AND o.actor_id IS NOT NULL
          AND (${all} OR o.actor_id=${tx.context.userId}::uuid)
          AND NOT EXISTS (SELECT 1 FROM file_operation_batch_items i WHERE i.organization_id=o.organization_id AND i.operation_id=o.id)
        UNION ALL
        SELECT b.id::text, 'file-batch', b.action, b.actor_id, NULL::text,
          (SELECT jsonb_agg(jsonb_build_object('state', grouped.state, 'count', grouped.count) ORDER BY grouped.state) FROM (
            SELECT CASE WHEN i."index"<>i.root_index THEN 'covered' ELSE coalesce(o.phase,'pending') END AS state, count(*)::int AS count
            FROM file_operation_batch_items i
            JOIN file_operation_batch_items root ON root.organization_id=i.organization_id AND root.batch_id=i.batch_id AND root."index"=i.root_index
            LEFT JOIN file_operations o ON o.organization_id=root.organization_id AND o.id=root.operation_id
            WHERE i.organization_id=b.organization_id AND i.batch_id=b.id GROUP BY 1
          ) grouped), b.created_at,
          coalesce((SELECT max(o.updated_at) FROM file_operation_batch_items i JOIN file_operations o ON o.organization_id=i.organization_id AND o.id=i.operation_id WHERE i.organization_id=b.organization_id AND i.batch_id=b.id),b.created_at),
          true, NULL::text
        FROM file_operation_batches b WHERE b.organization_id=${tx.context.organizationId}::uuid AND (${all} OR b.actor_id=${tx.context.userId}::uuid)
      )
      SELECT totals.total, records.* FROM (SELECT count(*)::int AS total FROM visible) totals
      LEFT JOIN (SELECT * FROM visible ORDER BY "createdAt" DESC, source, id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}) records ON true
      ORDER BY records."createdAt" DESC, records.source, records.id
    `)
    return {
      items: result.rows
        .filter((row) => row.id !== null)
        .map((row) => ({
          id: row.id!,
          source: row.source,
          type: row.type,
          actorId: row.actorId,
          status: row.status,
          states: row.states,
          resultAvailable: row.resultAvailable,
          errorCode: row.errorCode,
          createdAt: new Date(row.createdAt).toISOString(),
          updatedAt: new Date(row.updatedAt).toISOString(),
        })),
      total: result.rows[0]!.total,
      page,
      pageSize,
      visibility: all ? "organization" : "own",
    }
  },
  async create(tx: TenantTx, input: NewBusinessTask) {
    const [created] = await tx
      .insert(businessTasks)
      .values(input)
      .onConflictDoNothing()
      .returning()
    if (created) return created
    const [prior] = await tx
      .select()
      .from(businessTasks)
      .where(
        and(
          eq(businessTasks.organizationId, tx.context.organizationId),
          eq(businessTasks.actorId, tx.context.userId),
          eq(businessTasks.type, input.type),
          eq(businessTasks.idempotencyKey, input.idempotencyKey)
        )
      )
    if (!prior) throw new Error("TASK_SUBMISSION_NOT_RECORDED")
    return prior
  },
  async canReadOrganization(tx: TenantTx) {
    const [membership] = await tx
      .select({ role: member.role })
      .from(member)
      .where(
        and(
          eq(member.id, tx.context.membershipId),
          eq(member.organizationId, tx.context.organizationId),
          eq(member.userId, tx.context.userId)
        )
      )
    return (
      membership?.role
        .split(",")
        .some((role) => role === "owner" || role === "admin") ?? false
    )
  },
  async find(tx: TenantTx, id: string) {
    const [row] = await tx
      .select()
      .from(businessTasks)
      .where(
        and(
          eq(businessTasks.organizationId, tx.context.organizationId),
          eq(businessTasks.id, id)
        )
      )
    return row
  },
  async lock(tx: TenantTx, id: string) {
    const [row] = await tx
      .select()
      .from(businessTasks)
      .where(
        and(
          eq(businessTasks.organizationId, tx.context.organizationId),
          eq(businessTasks.id, id)
        )
      )
      .for("update")
    return row
  },
  async markQueued(tx: TenantTx, id: string) {
    await tx
      .update(businessTasks)
      .set({ status: "queued", updatedAt: new Date() })
      .where(
        and(
          eq(businessTasks.organizationId, tx.context.organizationId),
          eq(businessTasks.id, id),
          eq(businessTasks.status, "submitted")
        )
      )
  },
  async finish(
    tx: TenantTx,
    id: string,
    result: Record<string, unknown>,
    content: string,
    status: "completed" | "failed"
  ) {
    const [finished] = await tx
      .update(businessTasks)
      .set({
        status,
        errorCode: status === "failed" ? "IMPORT_VALIDATION_FAILED" : null,
        result,
        resultContent: content,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessTasks.organizationId, tx.context.organizationId),
          eq(businessTasks.id, id)
        )
      )
      .returning()
    await tx.insert(auditEvents).values({
      organizationId: tx.context.organizationId,
      scope: "tenant",
      eventCode: status === "completed" ? "task.completed" : "task.failed",
      result: status === "completed" ? "succeeded" : "failed",
      actorId: tx.context.userId,
      resourceType: "task",
      resourceId: id,
      requestId: tx.context.requestId,
      operationId: id,
      tenantVisible: true,
      fields: { count: result.count },
    })
    return finished!
  },
  async findVisible(tx: TenantTx, id: string) {
    const all = await this.canReadOrganization(tx)
    const [row] = await tx
      .select()
      .from(businessTasks)
      .where(
        and(
          eq(businessTasks.organizationId, tx.context.organizationId),
          eq(businessTasks.id, id),
          all ? undefined : eq(businessTasks.actorId, tx.context.userId)
        )
      )
    return row
  },
  async list(tx: TenantTx, page: number, pageSize: number) {
    const all = await this.canReadOrganization(tx)
    const where = and(
      eq(businessTasks.organizationId, tx.context.organizationId),
      all ? undefined : eq(businessTasks.actorId, tx.context.userId)
    )
    const items = await tx
      .select()
      .from(businessTasks)
      .where(where)
      .orderBy(desc(businessTasks.createdAt), desc(businessTasks.id))
      .offset((page - 1) * pageSize)
      .limit(pageSize)
    const [total] = await tx
      .select({ count: count() })
      .from(businessTasks)
      .where(where)
    return { items, total: total!.count, page, pageSize }
  },
}
