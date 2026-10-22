import { sql } from "drizzle-orm"
import { platformAnnouncements } from "./platform-announcements.js"
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

export const platformFilePolicy = pgTable(
  "platform_file_policy",
  {
    id: integer("id").primaryKey().default(1),
    quotaBytes: bigint("quota_bytes", { mode: "number" })
      .notNull()
      .default(10 * 1024 ** 3),
    usedBytes: bigint("used_bytes", { mode: "number" }).notNull().default(0),
    reservedBytes: bigint("reserved_bytes", { mode: "number" })
      .notNull()
      .default(0),
    transientBytes: bigint("transient_bytes", { mode: "number" })
      .notNull()
      .default(0),
    trashDays: integer("trash_days").notNull().default(30),
    historyDays: integer("history_days").notNull().default(90),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    check("platform_file_policy_singleton", sql`${table.id} = 1`),
    check(
      "platform_file_policy_values",
      sql`${table.quotaBytes} >= 0 AND ${table.usedBytes} >= 0 AND ${table.reservedBytes} >= 0 AND ${table.transientBytes} >= 0 AND ${table.trashDays} >= 1 AND ${table.historyDays} >= 1 AND ${table.revision} >= 1`
    ),
  ]
)

export const platformFileOperations = pgTable(
  "platform_file_operations",
  {
    id: uuid("id").primaryKey(),
    actorId: uuid("actor_id").notNull(),
    action: text("action").notNull(),
    requestId: text("request_id").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    phase: text("phase").notNull().default("pending"),
    entryId: uuid("entry_id"),
    objects: jsonb("objects")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    plans: jsonb("plans")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    reservedBytes: bigint("reserved_bytes", { mode: "number" })
      .notNull()
      .default(0),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    leaseId: uuid("lease_id").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("platform_file_operations_pending_idx").on(
      table.phase,
      table.leaseExpiresAt
    ),
    index("platform_file_operations_actor_idx").on(
      table.actorId,
      table.createdAt
    ),
    check(
      "platform_file_operations_action_check",
      sql`${table.action} IN ('create-folder','upload','overwrite','rename','move','trash','restore','purge')`
    ),
    check(
      "platform_file_operations_phase_check",
      sql`${table.phase} IN ('pending','preparing','committed','cleaning','completed','failed')`
    ),
    check(
      "platform_file_operations_reserved_check",
      sql`${table.reservedBytes} >= 0`
    ),
  ]
)

export const platformFileEntries = pgTable(
  "platform_file_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id"),
    kind: text("kind", { enum: ["file", "folder"] }).notNull(),
    name: text("name").notNull(),
    path: text("path").array().notNull(),
    revision: integer("revision").notNull().default(1),
    state: text("state", { enum: ["active", "trashed", "purged"] })
      .notNull()
      .default("active"),
    currentVersionId: uuid("current_version_id"),
    busyOperationId: uuid("busy_operation_id"),
    trashRootId: uuid("trash_root_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "platform_file_entries_parent_fk",
      columns: [table.parentId],
      foreignColumns: [table.id],
    }),
    uniqueIndex("platform_file_entries_root_unique")
      .on(sql`(true)`)
      .where(sql`${table.parentId} IS NULL`),
    uniqueIndex("platform_file_entries_active_name_unique")
      .on(table.parentId, table.name)
      .where(sql`${table.state} = 'active' AND ${table.parentId} IS NOT NULL`),
    index("platform_file_entries_parent_idx").on(table.parentId, table.state),
    index("platform_file_entries_trash_idx").on(table.state, table.expiresAt),
    check(
      "platform_file_entries_kind_check",
      sql`${table.kind} IN ('file','folder')`
    ),
    check(
      "platform_file_entries_state_check",
      sql`${table.state} IN ('active','trashed','purged')`
    ),
    check("platform_file_entries_revision_check", sql`${table.revision} >= 1`),
    check(
      "platform_file_entries_root_check",
      sql`(${table.parentId} IS NULL AND ${table.kind} = 'folder' AND ${table.name} = '' AND cardinality(${table.path}) = 0 AND ${table.state} = 'active') OR (${table.parentId} IS NOT NULL AND cardinality(${table.path}) > 0 AND ${table.path}[cardinality(${table.path})] = ${table.name})`
    ),
    check(
      "platform_file_entries_name_check",
      sql`${table.parentId} IS NULL OR (octet_length(${table.name}) BETWEEN 1 AND CASE WHEN ${table.kind} = 'folder' THEN 246 ELSE 255 END AND ${table.name} = btrim(${table.name}) AND ${table.name} = normalize(${table.name}, NFC) AND ${table.name} NOT IN ('.', '..') AND position('/' in ${table.name}) = 0 AND position(chr(92) in ${table.name}) = 0 AND ${table.name} !~ '[[:cntrl:]]' AND ${table.name} !~* '%(25)*(2f|5c)')`
    ),
    check(
      "platform_file_entries_path_check",
      sql`octet_length(array_to_string(${table.path}, '/')) <= 512`
    ),
    check(
      "platform_file_entries_folder_version_check",
      sql`${table.kind} = 'file' OR ${table.currentVersionId} IS NULL`
    ),
    check(
      "platform_file_entries_trash_check",
      sql`${table.state} <> 'trashed' OR (${table.trashRootId} IS NOT NULL AND ${table.deletedAt} IS NOT NULL AND ${table.expiresAt} IS NOT NULL)`
    ),
  ]
)

export const platformFileVersions = pgTable(
  "platform_file_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => platformFileEntries.id),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    sha256: text("sha256").notNull(),
    storageArea: text("storage_area").notNull(),
    storagePath: text("storage_path").array().notNull(),
    state: text("state").notNull().default("available"),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_file_versions_identity_unique").on(
      table.id,
      table.fileId
    ),
    index("platform_file_versions_file_idx").on(table.fileId, table.createdAt),
    index("platform_file_versions_expiry_idx").on(table.state, table.expiresAt),
    check(
      "platform_file_versions_content_check",
      sql`${table.bytes} >= 0 AND ${table.sha256} ~ '^[0-9a-f]{64}$' AND length(${table.contentType})>0`
    ),
    check(
      "platform_file_versions_location_check",
      sql`${table.storageArea} IN ('files','history','trash') AND cardinality(${table.storagePath})>0`
    ),
    check(
      "platform_file_versions_state_check",
      sql`${table.state} IN ('available','purged')`
    ),
  ]
)

export const platformFileReferences = pgTable(
  "platform_file_references",
  {
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => platformAnnouncements.id),
    fileId: uuid("file_id").notNull(),
    versionId: uuid("version_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.announcementId, table.fileId, table.versionId],
    }),
    foreignKey({
      name: "platform_file_references_version_fk",
      columns: [table.versionId, table.fileId],
      foreignColumns: [platformFileVersions.id, platformFileVersions.fileId],
    }),
    index("platform_file_references_version_idx").on(table.versionId),
  ]
)

export const platformFileBatches = pgTable("platform_file_batches", {
  id: uuid("id").primaryKey(),
  actorId: uuid("actor_id").notNull(),
  action: text("action").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  items: jsonb("items").$type<Record<string, unknown>[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})
