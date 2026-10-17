import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import { platformResources } from "./platform-resources.ts"

export const platformTasks = pgTable(
  "platform_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 历史任务绑定提交者和提交会话；会话撤销不能级联删除任务或导入收据。
    actorId: uuid("actor_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    kind: text("kind", { enum: ["export", "employee-import"] }).notNull(),
    resource: text("resource").notNull(),
    status: text("status", {
      enum: ["pending", "queued", "running", "completed", "failed", "rejected"],
    })
      .notNull()
      .default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    intentFingerprint: text("intent_fingerprint").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    credentialCiphertext: text("credential_ciphertext"),
    resultResourceId: uuid("result_resource_id").references(
      () => platformResources.id,
      { onDelete: "restrict" }
    ),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    requestId: text("request_id").notNull(),
  },
  (table) => [
    unique("platform_tasks_actor_idempotency_unique").on(
      table.actorId,
      table.idempotencyKey
    ),
    index("platform_tasks_actor_created_id_idx").on(
      table.actorId,
      table.createdAt,
      table.id
    ),
    index("platform_tasks_status_updated_id_idx").on(
      table.status,
      table.updatedAt,
      table.id
    ),
    check(
      "platform_tasks_kind_check",
      sql`${table.kind} IN ('export','employee-import')`
    ),
    check(
      "platform_tasks_resource_check",
      sql`${table.resource} IN ('employees','roles','menus','departments','posts','dictionaries','dictionary-items','parameters','users','organizations','login-events','sessions','audit-events')`
    ),
    check(
      "platform_tasks_status_check",
      sql`${table.status} IN ('pending','queued','running','completed','failed','rejected')`
    ),
    check(
      "platform_tasks_idempotency_check",
      sql`length(btrim(${table.idempotencyKey})) BETWEEN 1 AND 200`
    ),
    check(
      "platform_tasks_fingerprint_check",
      sql`${table.intentFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "platform_tasks_input_check",
      sql`jsonb_typeof(${table.input}) = 'object'`
    ),
    check(
      "platform_tasks_credential_check",
      sql`(${table.kind} = 'export' AND ${table.credentialCiphertext} IS NULL) OR (${table.kind} = 'employee-import' AND ${table.resource} = 'employees' AND ((${table.status} IN ('pending','queued','running') AND ${table.credentialCiphertext} IS NOT NULL AND length(${table.credentialCiphertext}) > 0) OR (${table.status} IN ('completed','failed','rejected') AND ${table.credentialCiphertext} IS NULL)))`
    ),
    check(
      "platform_tasks_result_check",
      sql`(${table.status} = 'completed' AND ${table.resultResourceId} IS NOT NULL AND ${table.errorCode} IS NULL) OR (${table.status} IN ('failed','rejected') AND ${table.resultResourceId} IS NULL AND ${table.result} IS NULL AND ${table.errorCode} IS NOT NULL AND ${table.errorCode} ~ '^[A-Z_]{1,100}$') OR (${table.status} IN ('pending','queued','running') AND ${table.resultResourceId} IS NULL AND ${table.result} IS NULL AND ${table.errorCode} IS NULL)`
    ),
  ]
)

export const platformTaskRows = pgTable(
  "platform_task_rows",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => platformTasks.id, { onDelete: "restrict" }),
    rowNumber: integer("row_number").notNull(),
    status: text("status", {
      enum: ["created", "updated", "granted", "skipped", "failed"],
    }).notNull(),
    // 只保存行号、结果与稳定错误码；邮箱、姓名和密码哈希不进入收据。
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.rowNumber] }),
    check(
      "platform_task_rows_number_check",
      sql`${table.rowNumber} BETWEEN 2 AND 10001`
    ),
    check(
      "platform_task_rows_status_check",
      sql`${table.status} IN ('created','updated','granted','skipped','failed')`
    ),
    check(
      "platform_task_rows_result_check",
      sql`jsonb_typeof(${table.result}) = 'object' AND ${table.result} ? 'outcome' AND jsonb_typeof(${table.result}->'outcome') = 'string' AND ${table.result}->>'outcome' = ${table.status} AND ((${table.status} = 'failed' AND ${table.result} ? 'code' AND jsonb_typeof(${table.result}->'code') = 'string' AND ${table.result}->>'code' ~ '^[A-Z_]{1,100}$' AND ${table.result} - 'outcome' - 'code' = '{}'::jsonb) OR (${table.status} <> 'failed' AND ${table.result} - 'outcome' = '{}'::jsonb))`
    ),
  ]
)
