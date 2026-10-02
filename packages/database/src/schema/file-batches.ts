import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import { organization } from "./auth.ts"

export const fileOperationBatches = pgTable(
  "file_operation_batches",
  {
    id: uuid("id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    actorId: uuid("actor_id").notNull(),
    action: text("action", {
      enum: ["move", "trash", "restore", "purge"],
    }).notNull(),
    requestHash: text("request_hash").notNull(),
    parentId: uuid("parent_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    check(
      "file_operation_batches_action_check",
      sql`${table.action} IN ('move','trash','restore','purge')`
    ),
    check(
      "file_operation_batches_target_check",
      sql`(${table.action} = 'move' AND ${table.parentId} IS NOT NULL) OR ${table.action} = 'restore' OR (${table.action} IN ('trash','purge') AND ${table.parentId} IS NULL)`
    ),
    check(
      "file_operation_batches_hash_check",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`
    ),
  ]
)

export const fileOperationBatchItems = pgTable(
  "file_operation_batch_items",
  {
    organizationId: uuid("organization_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    index: integer("index").notNull(),
    entryId: uuid("entry_id").notNull(),
    expectedRevision: integer("expected_revision").notNull(),
    operationId: uuid("operation_id").notNull(),
    rootIndex: integer("root_index").notNull(),
    entryKind: text("entry_kind", { enum: ["file", "folder"] }),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.batchId, table.index] }),
    foreignKey({
      name: "file_operation_batch_items_batch_fk",
      columns: [table.organizationId, table.batchId],
      foreignColumns: [
        fileOperationBatches.organizationId,
        fileOperationBatches.id,
      ],
    }),
    foreignKey({
      name: "file_operation_batch_items_root_fk",
      columns: [table.organizationId, table.batchId, table.rootIndex],
      foreignColumns: [table.organizationId, table.batchId, table.index],
    }),
    unique("file_operation_batch_items_entry_unique").on(
      table.organizationId,
      table.batchId,
      table.entryId
    ),
    unique("file_operation_batch_items_operation_unique").on(
      table.organizationId,
      table.batchId,
      table.operationId
    ),
    index("file_operation_batch_items_root_idx").on(
      table.organizationId,
      table.batchId,
      table.rootIndex
    ),
    check(
      "file_operation_batch_items_index_check",
      sql`${table.index} BETWEEN 0 AND 99 AND ${table.rootIndex} BETWEEN 0 AND 99`
    ),
    check(
      "file_operation_batch_items_revision_check",
      sql`${table.expectedRevision} >= 1`
    ),
    check(
      "file_operation_batch_items_kind_check",
      sql`${table.entryKind} IS NULL OR ${table.entryKind} IN ('file','folder')`
    ),
  ]
)
