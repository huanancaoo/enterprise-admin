import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core"

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  // 组织删除后仍需保留历史事实，因此审计组织标识不是生命周期外键。
  organizationId: uuid("organization_id").notNull(),
  eventCode: text("event_code").notNull(),
  // actor 和资源是历史事实，删除身份或业务资源不能删除审计。
  actorId: uuid("actor_id").notNull(),
  resourceId: uuid("resource_id").notNull(),
  requestId: text("request_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  fields: jsonb("fields").$type<Record<string, unknown>>().notNull(),
})
