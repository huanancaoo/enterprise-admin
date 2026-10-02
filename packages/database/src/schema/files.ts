import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { organization } from "./auth.ts"
import { projects } from "./projects.ts"

export type FileOperationPhase =
  "pending" | "preparing" | "committed" | "cleaning" | "completed" | "failed"
export type FileStorageArea = "files" | "history" | "trash" | "staging"
export type FileEntryPlan = {
  id: string
  expectedRevision: number
  previousParentId: string | null
  parentId: string | null
  previousName: string
  name: string
  previousPath: string[]
  path: string[]
  previousState: "active" | "trashed" | "purged"
  state: "active" | "trashed" | "purged"
  trashRootId: string | null
  deletedAt: string | null
  expiresAt: string | null
}

export const fileStorageUsage = pgTable(
  "file_storage_usage",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id),
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
    policyRevision: integer("policy_revision").notNull().default(1),
  },
  (table) => [
    check(
      "file_storage_usage_values_check",
      sql`${table.quotaBytes} >= 0 AND ${table.usedBytes} >= 0 AND ${table.reservedBytes} >= 0 AND ${table.transientBytes} >= 0 AND ${table.trashDays} >= 1 AND ${table.historyDays} >= 1 AND ${table.policyRevision} >= 1`
    ),
  ]
)

export const fileOperations = pgTable(
  "file_operations",
  {
    id: uuid("id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    actorId: uuid("actor_id").notNull(),
    action: text("action", {
      enum: [
        "upload",
        "overwrite",
        "create-folder",
        "rename",
        "move",
        "trash",
        "restore",
        "purge",
      ],
    }).notNull(),
    requestHash: text("request_hash").notNull(),
    requestId: text("request_id").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    plans: jsonb("plans").$type<FileEntryPlan[]>().notNull().default([]),
    phase: text("phase")
      .$type<FileOperationPhase>()
      .notNull()
      .default("pending"),
    reservedBytes: bigint("reserved_bytes", { mode: "number" })
      .notNull()
      .default(0),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    leaseId: uuid("lease_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("file_operations_claim_idx").on(
      table.phase,
      table.leaseExpiresAt,
      table.createdAt
    ),
    index("file_operations_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
      table.id
    ),
    check(
      "file_operations_phase_check",
      sql`${table.phase} IN ('pending', 'preparing', 'committed', 'cleaning', 'completed', 'failed')`
    ),
    check(
      "file_operations_action_check",
      sql`${table.action} IN ('upload', 'overwrite', 'create-folder', 'rename', 'move', 'trash', 'restore', 'purge')`
    ),
    check(
      "file_operations_hash_check",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`
    ),
    check("file_operations_reserved_check", sql`${table.reservedBytes} >= 0`),
  ]
)

export const fileEntries = pgTable(
  "file_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    kind: text("kind", { enum: ["file", "folder"] }).notNull(),
    parentId: uuid("parent_id"),
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
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("file_entries_organization_id_id_unique").on(
      table.organizationId,
      table.id
    ),
    foreignKey({
      name: "file_entries_parent_fk",
      columns: [table.organizationId, table.parentId],
      foreignColumns: [table.organizationId, table.id],
    }),
    foreignKey({
      name: "file_entries_busy_operation_fk",
      columns: [table.organizationId, table.busyOperationId],
      foreignColumns: [fileOperations.organizationId, fileOperations.id],
    }),
    uniqueIndex("file_entries_root_unique")
      .on(table.organizationId)
      .where(sql`${table.parentId} IS NULL`),
    uniqueIndex("file_entries_active_name_unique")
      .on(table.organizationId, table.parentId, table.name)
      .where(sql`${table.state} = 'active' AND ${table.parentId} IS NOT NULL`),
    index("file_entries_parent_idx").on(
      table.organizationId,
      table.parentId,
      table.state
    ),
    index("file_entries_trash_idx").on(
      table.organizationId,
      table.state,
      table.expiresAt
    ),
    check("file_entries_kind_check", sql`${table.kind} IN ('file', 'folder')`),
    check(
      "file_entries_state_check",
      sql`${table.state} IN ('active', 'trashed', 'purged')`
    ),
    check("file_entries_revision_check", sql`${table.revision} >= 1`),
    check(
      "file_entries_root_check",
      sql`(${table.parentId} IS NULL AND ${table.kind} = 'folder' AND ${table.name} = '' AND cardinality(${table.path}) = 0 AND ${table.state} = 'active') OR (${table.parentId} IS NOT NULL AND cardinality(${table.path}) > 0 AND ${table.path}[cardinality(${table.path})] = ${table.name})`
    ),
    check(
      "file_entries_name_check",
      sql`${table.parentId} IS NULL OR (octet_length(${table.name}) BETWEEN 1 AND CASE WHEN ${table.kind} = 'folder' THEN 246 ELSE 255 END AND ${table.name} = btrim(${table.name}) AND ${table.name} = normalize(${table.name}, NFC) AND ${table.name} NOT IN ('.', '..') AND position('/' in ${table.name}) = 0 AND position(chr(92) in ${table.name}) = 0 AND ${table.name} !~ '[[:cntrl:]]' AND ${table.name} !~* '%(25)*(2f|5c)')`
    ),
    check(
      "file_entries_path_check",
      sql`octet_length(array_to_string(${table.path}, '/')) <= 512`
    ),
    check(
      "file_entries_folder_version_check",
      sql`${table.kind} = 'file' OR ${table.currentVersionId} IS NULL`
    ),
    check(
      "file_entries_trash_check",
      sql`${table.state} <> 'trashed' OR (${table.trashRootId} IS NOT NULL AND ${table.deletedAt} IS NOT NULL AND ${table.expiresAt} IS NOT NULL)`
    ),
  ]
)

export const fileVersions = pgTable(
  "file_versions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    fileId: uuid("file_id").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    contentType: text("content_type").notNull(),
    storageArea: text("storage_area").$type<FileStorageArea>().notNull(),
    storagePath: text("storage_path").array().notNull(),
    archivedPath: text("archived_path").array(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
  },
  (table) => [
    unique("file_versions_organization_file_id_unique").on(
      table.organizationId,
      table.fileId,
      table.id
    ),
    foreignKey({
      name: "file_versions_file_fk",
      columns: [table.organizationId, table.fileId],
      foreignColumns: [fileEntries.organizationId, fileEntries.id],
    }),
    index("file_versions_file_idx").on(
      table.organizationId,
      table.fileId,
      table.createdAt,
      table.id
    ),
    index("file_versions_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.purgedAt} IS NULL`),
    check("file_versions_bytes_check", sql`${table.bytes} >= 0`),
    check(
      "file_versions_sha256_check",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "file_versions_area_check",
      sql`${table.storageArea} IN ('files', 'history', 'trash', 'staging')`
    ),
  ]
)

export const fileOperationObjects = pgTable(
  "file_operation_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    versionId: uuid("version_id"),
    directory: boolean("directory").notNull(),
    sourceArea: text("source_area").$type<FileStorageArea>(),
    sourcePath: text("source_path").array(),
    targetArea: text("target_area").$type<FileStorageArea>(),
    targetPath: text("target_path").array(),
    expectedBytes: bigint("expected_bytes", { mode: "number" }),
    expectedSha256: text("expected_sha256"),
    actualBytes: bigint("actual_bytes", { mode: "number" }),
    actualSha256: text("actual_sha256"),
    transientBytes: bigint("transient_bytes", { mode: "number" })
      .notNull()
      .default(0),
    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    sourceDeletedAt: timestamp("source_deleted_at", { withTimezone: true }),
    sourceRestoredAt: timestamp("source_restored_at", { withTimezone: true }),
    targetDeletedAt: timestamp("target_deleted_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "file_operation_objects_operation_fk",
      columns: [table.organizationId, table.operationId],
      foreignColumns: [fileOperations.organizationId, fileOperations.id],
    }),
    index("file_operation_objects_operation_idx").on(
      table.organizationId,
      table.operationId
    ),
    check(
      "file_operation_objects_bytes_check",
      sql`(${table.expectedBytes} IS NULL OR ${table.expectedBytes} >= 0) AND (${table.actualBytes} IS NULL OR ${table.actualBytes} >= 0) AND ${table.transientBytes} >= 0`
    ),
    check(
      "file_operation_objects_source_check",
      sql`(${table.sourceArea} IS NULL) = (${table.sourcePath} IS NULL)`
    ),
    check(
      "file_operation_objects_target_check",
      sql`(${table.targetArea} IS NULL) = (${table.targetPath} IS NULL)`
    ),
  ]
)

export const fileNamespaceReservations = pgTable(
  "file_namespace_reservations",
  {
    organizationId: uuid("organization_id").notNull(),
    parentId: uuid("parent_id").notNull(),
    name: text("name").notNull(),
    operationId: uuid("operation_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.parentId, table.name] }),
    foreignKey({
      name: "file_namespace_reservations_operation_fk",
      columns: [table.organizationId, table.operationId],
      foreignColumns: [fileOperations.organizationId, fileOperations.id],
    }),
    foreignKey({
      name: "file_namespace_reservations_parent_fk",
      columns: [table.organizationId, table.parentId],
      foreignColumns: [fileEntries.organizationId, fileEntries.id],
    }),
  ]
)

export const fileReferences = pgTable(
  "file_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    kind: text("kind", {
      enum: ["project_attachment", "project_rich_text"],
    }).notNull(),
    locale: text("locale"),
    referenceKey: text("reference_key").notNull(),
    position: integer("position").notNull().default(0),
    fileId: uuid("file_id").notNull(),
    versionId: uuid("version_id").notNull(),
  },
  (table) => [
    foreignKey({
      name: "file_references_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "file_references_version_fk",
      columns: [table.organizationId, table.fileId, table.versionId],
      foreignColumns: [
        fileVersions.organizationId,
        fileVersions.fileId,
        fileVersions.id,
      ],
    }),
    unique("file_references_business_slot_unique")
      .on(
        table.organizationId,
        table.projectId,
        table.kind,
        table.locale,
        table.referenceKey
      )
      .nullsNotDistinct(),
    index("file_references_version_idx").on(
      table.organizationId,
      table.fileId,
      table.versionId
    ),
    check(
      "file_references_kind_locale_check",
      sql`(${table.kind} = 'project_attachment' AND ${table.locale} IS NULL) OR (${table.kind} = 'project_rich_text' AND ${table.locale} IN ('zh-CN', 'en-US', 'ar'))`
    ),
    check("file_references_position_check", sql`${table.position} >= 0`),
  ]
)

export const projectFileContents = pgTable(
  "project_file_contents",
  {
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    locale: text("locale").notNull(),
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    revision: integer("revision").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.projectId, table.locale],
    }),
    foreignKey({
      name: "project_file_contents_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    check(
      "project_file_contents_locale_check",
      sql`${table.locale} IN ('zh-CN', 'en-US', 'ar')`
    ),
    check("project_file_contents_revision_check", sql`${table.revision} >= 1`),
  ]
)
