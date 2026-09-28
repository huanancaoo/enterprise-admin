import { sql } from "drizzle-orm"
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

// 这是 SMTP 事实，不是第二套邀请生命周期；由身份集成边界授权访问。
export const invitationDeliveryAttempts = pgTable(
  "invitation_delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invitationId: uuid("invitation_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    status: text("status").notNull().default("pending"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "invitation_delivery_status_check",
      sql`${table.status} IN ('pending', 'smtp_accepted', 'failed', 'unknown')`
    ),
    index("invitation_delivery_latest_idx").on(
      table.invitationId,
      table.createdAt
    ),
  ]
)

export const invitationSendEvents = pgTable(
  "invitation_send_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    email: text("email").notNull(),
    ipHash: text("ip_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("invitation_send_window_idx").on(table.createdAt)]
)
