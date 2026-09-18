import { sql } from "drizzle-orm"
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea"
  },
})

export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 认证信在登录前发出，没有组织；邀请信有组织。都不是租户业务行，不能挂 RLS。
    organizationId: uuid("organization_id"),
    type: text("type").notNull(),
    templateKey: text("template_key").notNull(),
    templateVersion: integer("template_version").notNull(),
    locale: text("locale").notNull(),
    provider: text("provider").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    recipientHash: bytea("recipient_hash").notNull(),
    payloadCiphertext: bytea("payload_ciphertext").notNull(),
    payloadKeyId: text("payload_key_id"),
    status: text("status").notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    providerMessageId: text("provider_message_id"),
    lastErrorCode: text("last_error_code"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "email_messages_status_check",
      sql`${table.status} IN ('queued', 'sending', 'retry', 'accepted', 'failed', 'expired')`
    ),
    check(
      "email_messages_template_version_check",
      sql`${table.templateVersion} >= 1`
    ),
    check(
      "email_messages_attempt_count_check",
      sql`${table.attemptCount} >= 0`
    ),
    index("email_messages_dispatch_idx").on(
      table.status,
      table.nextAttemptAt,
      table.createdAt
    ),
  ]
)
