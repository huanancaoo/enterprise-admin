import { and, desc, eq, lt, or, sql } from "drizzle-orm"
import { auditEvents } from "../schema/audit.ts"
import type { TenantTx } from "../tenant.ts"

export type AuditEventFilter = {
  from: Date
  to: Date
  actorId?: string
  eventCode?: string
  resourceType?: string
  resourceId?: string
  result?: string
}

export type AuditEventCursor = {
  occurredAt: string
  id: string
}

const visibleToTenant = and(
  eq(auditEvents.tenantVisible, true),
  or(eq(auditEvents.scope, "tenant"), eq(auditEvents.scope, "platform")),
)

export const auditRepository = {
  record(
    tx: TenantTx,
    input: {
      eventCode: string
      resourceId: string
      fields: Record<string, unknown>
    }
  ) {
    return tx.insert(auditEvents).values({
      ...input,
      resourceType: "project",
      organizationId: tx.context.organizationId,
      actorId: tx.context.userId,
      requestId: tx.context.requestId,
    })
  },

  async listPage(
    tx: TenantTx,
    input: {
      filter: AuditEventFilter
      cursor?: AuditEventCursor
      limit: number
    },
  ) {
    const cursorFilter = input.cursor
      ? or(
          lt(
            auditEvents.occurredAt,
            sql`${input.cursor.occurredAt}::timestamptz`,
          ),
          and(
            eq(
              auditEvents.occurredAt,
              sql`${input.cursor.occurredAt}::timestamptz`,
            ),
            lt(auditEvents.id, input.cursor.id),
          ),
        )
      : undefined
    const rows = await tx
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
          eq(auditEvents.organizationId, tx.context.organizationId),
          visibleToTenant,
          sql`${auditEvents.occurredAt} >= ${input.filter.from}`,
          sql`${auditEvents.occurredAt} <= ${input.filter.to}`,
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
          input.filter.actorId || input.filter.resourceType || input.filter.resourceId
            ? eq(auditEvents.scope, "tenant")
            : undefined,
          input.filter.result
            ? eq(auditEvents.result, input.filter.result)
            : undefined,
          cursorFilter,
        ),
      )
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(input.limit + 1)
    const hasMore = rows.length > input.limit
    const items = rows.slice(0, input.limit)
    const last = items.at(-1)
    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? { occurredAt: last.occurredAt, id: last.id }
          : undefined,
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
          visibleToTenant,
        ),
      )
      .limit(1)
    return event
  },
}
