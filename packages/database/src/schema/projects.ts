import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import { organization } from "./auth.ts"

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    status: text("status", { enum: ["draft", "active", "archived"] })
      .notNull()
      .default("draft"),
    contentLocale: text("content_locale", {
      enum: ["zh-CN", "en-US", "ar"],
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("projects_organization_id_id_unique").on(
      table.organizationId,
      table.id
    ),
    check(
      "projects_status_check",
      sql`${table.status} IN ('draft', 'active', 'archived')`
    ),
    check(
      "projects_content_locale_check",
      sql`${table.contentLocale} IN ('zh-CN', 'en-US', 'ar')`
    ),
  ]
)

export const projectTranslations = pgTable(
  "project_translations",
  {
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    locale: text("locale", { enum: ["zh-CN", "en-US", "ar"] }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (table) => [
    unique("project_translations_organization_project_locale_unique").on(
      table.organizationId,
      table.projectId,
      table.locale
    ),
    foreignKey({
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    check(
      "project_translations_locale_check",
      sql`${table.locale} IN ('zh-CN', 'en-US', 'ar')`
    ),
    check(
      "project_translations_name_check",
      sql`length(btrim(${table.name})) > 0`
    ),
  ]
)
