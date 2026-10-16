import { and, eq, isNotNull, or, sql } from "drizzle-orm"
import { auditEvents } from "../schema/audit.ts"
import type { TenantTx } from "../tenant.ts"

export type AuditEventFilter = {
  from: string
  to: string
  actorId?: string
  eventCode?: string
  resourceType?: string
  resourceId?: string
  result?: string
}

const visibleToTenant = and(
  eq(auditEvents.tenantVisible, true),
  or(
    eq(auditEvents.scope, "tenant"),
    and(eq(auditEvents.scope, "platform"), isNotNull(auditEvents.publicSummary))
  )
)

export const auditRepository = {
  record(
    tx: TenantTx,
    input: {
      eventCode: string
      resourceId: string
      resourceType: string
      fields: Record<string, unknown>
    }
  ) {
    return tx.insert(auditEvents).values({
      ...input,
      scope: "tenant",
      tenantVisible: true,
      organizationId: tx.context.organizationId,
      actorId: tx.context.userId,
      requestId: tx.context.requestId,
    })
  },

  async listPage(
    tx: TenantTx,
    input: {
      filter: AuditEventFilter
      page: number
      pageSize: number
    }
  ) {
    const filter = and(
      eq(auditEvents.organizationId, tx.context.organizationId),
      visibleToTenant,
      sql`${auditEvents.occurredAt} >= ${input.filter.from}::timestamptz`,
      sql`${auditEvents.occurredAt} <= ${input.filter.to}::timestamptz`,
      input.filter.actorId
        ? eq(auditEvents.actorId, input.filter.actorId)
        : undefined,
      input.filter.eventCode
        ? eq(auditEvents.eventCode, input.filter.eventCode)
        : undefined,
      input.filter.resourceType
        ? eq(auditEvents.resourceType, input.filter.resourceType)
        : undefined,
      input.filter.resourceId
        ? eq(auditEvents.resourceId, input.filter.resourceId)
        : undefined,
      input.filter.actorId ||
        input.filter.resourceType ||
        input.filter.resourceId
        ? eq(auditEvents.scope, "tenant")
        : undefined,
      input.filter.result
        ? eq(auditEvents.result, input.filter.result)
        : undefined
    )!
    const result = await tx.execute<{
      id: string | null
      occurredAt: string | null
      sortTime: Date | null
      eventCode: string | null
      scope: "tenant" | "platform" | null
      actorType: "user" | "deployment_operator" | "system" | null
      actorId: string | null
      resourceType: string | null
      resourceId: string | null
      result: "succeeded" | "denied" | "failed" | "no_change" | null
      tenantVisible: boolean | null
      publicSummary: string | null
      fields: Record<string, unknown> | null
      total: number
    }>(sql`
      SELECT totals.total, page.*
      FROM (
        SELECT count(*)::int AS total FROM ${auditEvents} WHERE ${filter}
      ) totals
      LEFT JOIN LATERAL (
        SELECT ${auditEvents.id} AS id,
          to_char(${auditEvents.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "occurredAt",
          ${auditEvents.occurredAt} AS "sortTime",
          ${auditEvents.eventCode} AS "eventCode",
          ${auditEvents.scope} AS scope,
          ${auditEvents.actorType} AS "actorType",
          ${auditEvents.actorId} AS "actorId",
          ${auditEvents.resourceType} AS "resourceType",
          ${auditEvents.resourceId} AS "resourceId",
          ${auditEvents.result} AS result,
          ${auditEvents.tenantVisible} AS "tenantVisible",
          ${auditEvents.publicSummary} AS "publicSummary",
          ${auditEvents.fields} AS fields
        FROM ${auditEvents}
        WHERE ${filter}
        ORDER BY ${auditEvents.occurredAt} DESC, ${auditEvents.id} DESC
        LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
      ) page ON true
      ORDER BY page."sortTime" DESC, page.id DESC
    `)
    const first = result.rows[0]!
    const items = result.rows
      .filter((row) => row.id !== null)
      .map((row) => ({
        id: row.id!,
        occurredAt: row.occurredAt!,
        eventCode: row.eventCode!,
        scope: row.scope!,
        actorType: row.actorType!,
        actorId: row.actorId,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        result: row.result!,
        tenantVisible: row.tenantVisible!,
        publicSummary: row.publicSummary,
        fields: row.fields!,
      }))
    return {
      items,
      total: first.total,
      page: input.page,
      pageSize: input.pageSize,
    }
  },

  async findVisibleById(tx: TenantTx, eventId: string) {
    const [event] = await tx
      .select({
        id: auditEvents.id,
        occurredAt: sql<string>`to_char(${auditEvents.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        eventCode: auditEvents.eventCode,
        scope: auditEvents.scope,
        actorType: auditEvents.actorType,
        actorId: auditEvents.actorId,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        result: auditEvents.result,
        tenantVisible: auditEvents.tenantVisible,
        publicSummary: auditEvents.publicSummary,
        fields: auditEvents.fields,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.id, eventId),
          eq(auditEvents.organizationId, tx.context.organizationId),
          visibleToTenant
        )
      )
      .limit(1)
    return event
  },
}
