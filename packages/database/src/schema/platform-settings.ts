import { sql } from "drizzle-orm"
import { boolean, check, integer, pgTable, text } from "drizzle-orm/pg-core"

export const platformSettings = pgTable(
  "platform_settings",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    defaultLocale: text("default_locale", {
      enum: ["zh-CN", "en-US", "ar"],
    }).notNull(),
    version: integer("version").default(1).notNull(),
  },
  (table) => [
    check("platform_settings_singleton_check", sql`${table.singleton}`),
    check(
      "platform_settings_locale_check",
      sql`${table.defaultLocale} IN ('zh-CN', 'en-US', 'ar')`
    ),
    check("platform_settings_version_check", sql`${table.version} >= 1`),
  ]
)
