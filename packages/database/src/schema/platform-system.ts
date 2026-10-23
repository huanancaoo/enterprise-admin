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
  type AnyPgColumn,
} from "drizzle-orm/pg-core"

const status = () =>
  text("status", { enum: ["active", "disabled"] })
    .notNull()
    .default("active")
const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})
const catalog = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  status: status(),
  sort: integer("sort").notNull().default(0),
  ...timestamps(),
})

export const platformDepartment = pgTable(
  "platform_department",
  {
    ...catalog(),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => platformDepartment.id,
      { onDelete: "restrict" }
    ),
  },
  (table) => [
    index("platform_department_parent_sort_idx").on(
      table.parentId,
      table.sort,
      table.id
    ),
    check(
      "platform_department_status_check",
      sql`${table.status} IN ('active', 'disabled')`
    ),
    check(
      "platform_department_key_check",
      sql`${table.key} ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$'`
    ),
    check(
      "platform_department_name_check",
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`
    ),
    check("platform_department_sort_check", sql`${table.sort} >= 0`),
    check(
      "platform_department_parent_check",
      sql`${table.id} <> ${table.parentId}`
    ),
  ]
)

export const platformPost = pgTable(
  "platform_post",
  { ...catalog() },
  (table) => [
    check(
      "platform_post_status_check",
      sql`${table.status} IN ('active', 'disabled')`
    ),
    check(
      "platform_post_key_check",
      sql`${table.key} ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$'`
    ),
    check(
      "platform_post_name_check",
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`
    ),
    check("platform_post_sort_check", sql`${table.sort} >= 0`),
  ]
)
export const platformDictionary = pgTable(
  "platform_dictionary",
  { ...catalog(), remark: text("remark") },
  (table) => [
    check(
      "platform_dictionary_status_check",
      sql`${table.status} IN ('active', 'disabled')`
    ),
    check(
      "platform_dictionary_key_check",
      sql`${table.key} ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$'`
    ),
    check(
      "platform_dictionary_name_check",
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`
    ),
    check("platform_dictionary_sort_check", sql`${table.sort} >= 0`),
    check(
      "platform_dictionary_remark_check",
      sql`length(${table.remark}) <= 1000`
    ),
  ]
)
export const platformDictionaryItem = pgTable(
  "platform_dictionary_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dictionaryId: uuid("dictionary_id")
      .notNull()
      .references(() => platformDictionary.id, { onDelete: "restrict" }),
    value: text("value").notNull(),
    label: text("label").notNull(),
    status: status(),
    sort: integer("sort").notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    unique("platform_dictionary_item_dictionary_value_unique").on(
      table.dictionaryId,
      table.value
    ),
    index("platform_dictionary_item_dictionary_sort_idx").on(
      table.dictionaryId,
      table.sort,
      table.id
    ),
    check(
      "platform_dictionary_item_status_check",
      sql`${table.status} IN ('active', 'disabled')`
    ),
    check("platform_dictionary_item_sort_check", sql`${table.sort} >= 0`),
    check(
      "platform_dictionary_item_value_check",
      sql`length(btrim(${table.value})) BETWEEN 1 AND 500`
    ),
    check(
      "platform_dictionary_item_label_check",
      sql`length(btrim(${table.label})) BETWEEN 1 AND 200`
    ),
  ]
)
export const platformParameter = pgTable(
  "platform_parameter",
  { ...catalog(), value: text("value").notNull(), remark: text("remark") },
  (table) => [
    check(
      "platform_parameter_status_check",
      sql`${table.status} IN ('active', 'disabled')`
    ),
    check(
      "platform_parameter_key_check",
      sql`${table.key} ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$'`
    ),
    check(
      "platform_parameter_name_check",
      sql`length(btrim(${table.name})) BETWEEN 1 AND 200`
    ),
    check("platform_parameter_sort_check", sql`${table.sort} >= 0`),
    check(
      "platform_parameter_value_check",
      sql`length(${table.value}) <= 10000`
    ),
    check(
      "platform_parameter_remark_check",
      sql`length(${table.remark}) <= 1000`
    ),
  ]
)

export const platformSystemCacheRevision = pgTable(
  "platform_system_cache_revision",
  {
    resource: text("resource", {
      enum: ["dictionary", "parameter"],
    }).primaryKey(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check(
      "platform_system_cache_revision_resource_check",
      sql`${table.resource} IN ('dictionary', 'parameter')`
    ),
    check(
      "platform_system_cache_revision_version_check",
      sql`${table.version} >= 1`
    ),
  ]
)
export const platformSystemCache = pgTable(
  "platform_system_cache",
  {
    resource: text("resource")
      .notNull()
      .references(() => platformSystemCacheRevision.resource, {
        onDelete: "restrict",
      }),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({
      name: "platform_system_cache_pkey",
      columns: [table.resource, table.key],
    }),
    check("platform_system_cache_version_check", sql`${table.version} >= 1`),
  ]
)
