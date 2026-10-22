import { sql } from "drizzle-orm"
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  check,
} from "drizzle-orm/pg-core"

export const platformAnnouncements = pgTable(
  "platform_announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull().default("draft"),
    audience: text("audience").notNull(),
    organizationIds: uuid("organization_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    // 附件数组保存不可变版本 ID，文件名称和当前版本可以继续演进。
    attachments: uuid("attachments")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    authorId: uuid("author_id").notNull(),
    version: integer("version").notNull().default(1),
    publicationId: uuid("publication_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("platform_announcements_updated_idx").on(t.updatedAt, t.id),
    check(
      "platform_announcements_status_check",
      sql`${t.status} IN ('draft','published','withdrawn')`
    ),
    check(
      "platform_announcements_type_check",
      sql`${t.type} IN ('notice','announcement')`
    ),
    check(
      "platform_announcements_audience_check",
      sql`${t.audience} IN ('platform','allTenants','organizations')`
    ),
  ]
)

// 发布批次保存当时正文与受众；草稿后续编辑不能改写已经发生的阅读事实。
export const platformAnnouncementPublications = pgTable(
  "platform_announcement_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => platformAnnouncements.id),
    title: text("title").notNull(),
    type: text("type").notNull(),
    audience: text("audience").notNull(),
    organizationIds: uuid("organization_ids").array().notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    // 附件数组保存不可变版本 ID，文件名称和当前版本可以继续演进。
    attachments: uuid("attachments").array().notNull(),
    publishedBy: uuid("published_by").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("platform_publications_announcement_idx").on(
      t.announcementId,
      t.publishedAt
    ),
  ]
)

export const platformAnnouncementReads = pgTable(
  "platform_announcement_reads",
  {
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => platformAnnouncementPublications.id),
    userId: uuid("user_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.publicationId, t.userId] }),
    index("platform_announcement_reads_user_idx").on(t.userId, t.publicationId),
  ]
)
