import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core"
import { organization } from "./auth.ts"

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organization.id),
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
