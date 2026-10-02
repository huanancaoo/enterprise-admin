import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

export const personalMediaOperations = pgTable(
  "personal_media_operations",
  {
    id: uuid("id").notNull(),
    // 身份删除不能级联丢失尚未完成物理清理的媒体归属和执行事实。
    userId: uuid("user_id").notNull(),
    mediaId: uuid("media_id").notNull(),
    requestHash: text("request_hash").notNull(),
    requestId: text("request_id").notNull(),
    declaredBytes: bigint("declared_bytes", { mode: "number" }).notNull(),
    phase: text("phase", {
      enum: ["pending", "preparing", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    actualBytes: bigint("actual_bytes", { mode: "number" }),
    actualSha256: text("actual_sha256"),
    contentType: text("content_type"),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cleanedAt: timestamp("cleaned_at", { withTimezone: true }),
    leaseId: uuid("lease_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    unique("personal_media_operations_media_unique").on(table.mediaId),
    index("personal_media_operations_expiry_idx").on(
      table.phase,
      table.expiresAt,
      table.leaseExpiresAt
    ),
    check(
      "personal_media_operations_hash_check",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "personal_media_operations_size_check",
      sql`${table.declaredBytes} BETWEEN 1 AND 5242880 AND (${table.actualBytes} IS NULL OR ${table.actualBytes} = ${table.declaredBytes})`
    ),
    check(
      "personal_media_operations_phase_check",
      sql`${table.phase} IN ('pending','preparing','completed','failed')`
    ),
    check(
      "personal_media_operations_commit_check",
      sql`(${table.phase} = 'completed' AND ${table.committedAt} IS NOT NULL AND ${table.completedAt} IS NOT NULL) OR (${table.phase} <> 'completed' AND ${table.committedAt} IS NULL AND ${table.completedAt} IS NULL)`
    ),
  ]
)

export const personalMedia = pgTable(
  "personal_media",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    contentType: text("content_type").notNull(),
    storagePath: text("storage_path").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    purgeOperationId: uuid("purge_operation_id"),
    purgeLeaseId: uuid("purge_lease_id"),
    purgeLeaseExpiresAt: timestamp("purge_lease_expires_at", {
      withTimezone: true,
    }),
    purgeErrorCode: text("purge_error_code"),
  },
  (table) => [
    foreignKey({
      name: "personal_media_operation_fk",
      columns: [table.userId, table.operationId],
      foreignColumns: [
        personalMediaOperations.userId,
        personalMediaOperations.id,
      ],
    }),
    index("personal_media_user_idx").on(table.userId, table.id),
    index("personal_media_expiry_idx")
      .on(table.expiresAt, table.purgeLeaseExpiresAt)
      .where(sql`${table.purgedAt} IS NULL`),
    check(
      "personal_media_size_check",
      sql`${table.bytes} BETWEEN 1 AND 5242880`
    ),
    check("personal_media_hash_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "personal_media_type_check",
      sql`${table.contentType} IN ('image/jpeg','image/png','image/webp','image/gif')`
    ),
    check(
      "personal_media_path_check",
      sql`cardinality(${table.storagePath}) = 1 AND ${table.storagePath}[1] = ${table.id}::text`
    ),
  ]
)
