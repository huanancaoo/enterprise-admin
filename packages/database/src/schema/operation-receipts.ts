import { sql } from "drizzle-orm"
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

export const operationReceipts = pgTable(
  "operation_receipts",
  {
    actorId: uuid("actor_id").notNull(),
    scopeKey: text("scope_key").notNull(),
    action: text("action").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    operationId: uuid("operation_id").notNull(),
    safeResult: jsonb("safe_result").$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.actorId,
        table.scopeKey,
        table.action,
        table.idempotencyKey,
      ],
    }),
    index("operation_receipts_expires_idx").on(table.expiresAt),
    check("operation_receipts_scope_check", sql`length(${table.scopeKey}) > 0`),
  ]
)
