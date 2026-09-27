import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 组织删除后仍需保留历史事实，因此审计组织标识不是生命周期外键。
    organizationId: uuid("organization_id").notNull(),
    scope: text("scope").notNull().default("tenant"),
    eventCode: text("event_code").notNull(),
    actorType: text("actor_type").notNull().default("user"),
    // actor 和资源是历史事实，删除身份或业务资源不能删除审计。
    actorId: uuid("actor_id"),
    resourceType: text("resource_type"),
    resourceId: uuid("resource_id"),
    result: text("result").notNull().default("succeeded"),
    reason: text("reason"),
    requestId: text("request_id").notNull(),
    operationId: text("operation_id"),
    tenantVisible: boolean("tenant_visible").notNull().default(false),
    publicSummary: text("public_summary"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    fields: jsonb("fields").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    index("audit_events_organization_occurred_id_idx").on(
      table.organizationId,
      table.occurredAt,
      table.id
    ),
    check(
      "audit_events_scope_check",
      sql`${table.scope} IN ('tenant', 'platform', 'user', 'security')`
    ),
    check(
      "audit_events_actor_type_check",
      sql`${table.actorType} IN ('user', 'deployment_operator', 'system')`
    ),
    check(
      "audit_events_result_check",
      sql`${table.result} IN ('succeeded', 'denied', 'failed', 'no_change')`
    ),
    check(
      "audit_events_platform_summary_check",
      sql`${table.scope} <> 'platform' OR NOT ${table.tenantVisible} OR (${table.publicSummary} IS NOT NULL AND length(btrim(${table.publicSummary})) > 0)`
    ),
  ]
)
