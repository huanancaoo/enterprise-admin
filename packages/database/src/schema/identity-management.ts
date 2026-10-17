import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth.ts"

export const userAccountStatus = pgTable(
  "user_account_status",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["active", "suspended"] }).notNull(),
    version: integer("version").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "user_account_status_status_check",
      sql`${table.status} IN ('active', 'suspended')`
    ),
    check("user_account_status_version_check", sql`${table.version} >= 1`),
  ]
)

export const loginEvents = pgTable(
  "login_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 登录事实不随身份删除而级联消失；匿名失败没有可关联的账号。
    userId: uuid("user_id"),
    name: text("name"),
    maskedEmail: text("masked_email"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    method: text("method", { enum: ["email", "github", "totp"] }).notNull(),
    result: text("result", { enum: ["succeeded", "failed"] }).notNull(),
    reasonCode: text("reason_code"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    requestId: text("request_id").notNull(),
  },
  (table) => [
    index("login_events_occurred_id_idx").on(table.occurredAt, table.id),
    index("login_events_user_occurred_id_idx").on(
      table.userId,
      table.occurredAt,
      table.id
    ),
    check(
      "login_events_method_check",
      sql`${table.method} IN ('email', 'github', 'totp')`
    ),
    check(
      "login_events_result_check",
      sql`${table.result} IN ('succeeded', 'failed')`
    ),
  ]
)
