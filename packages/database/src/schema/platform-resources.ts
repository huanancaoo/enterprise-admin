import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

export const platformResources = pgTable(
  "platform_resources",
  {
    id: uuid("id").primaryKey(),
    purpose: text("purpose", {
      enum: ["task-input", "task-output"],
    }).notNull(),
    // 上传事实独立于账号生命周期；删除员工任职不能清除任务产物。
    uploadedBy: uuid("uploaded_by").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("platform_resources_uploader_created_idx").on(
      table.uploadedBy,
      table.createdAt
    ),
    check(
      "platform_resources_purpose_check",
      sql`${table.purpose} IN ('task-input','task-output')`
    ),
    check(
      "platform_resources_name_check",
      sql`octet_length(btrim(${table.name})) BETWEEN 1 AND 255`
    ),
    check(
      "platform_resources_mime_check",
      sql`${table.mimeType} ~ '^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$'`
    ),
    check(
      "platform_resources_bytes_check",
      sql`${table.bytes} BETWEEN 0 AND 9007199254740991`
    ),
    check(
      "platform_resources_hash_check",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`
    ),
  ]
)
