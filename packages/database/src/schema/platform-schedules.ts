import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

export const platformSchedules = pgTable(
  "platform_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    taskType: text("task_type").notNull(),
    cron: text("cron").notNull(),
    timeZone: text("time_zone").notNull(),
    status: text("status").notNull(),
    createdBy: uuid("created_by").notNull(),
    version: integer("version").notNull().default(1),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("platform_schedules_due_idx").on(
      table.status,
      table.nextRunAt,
      table.id
    ),
    check(
      "platform_schedules_type_check",
      sql`${table.taskType} = 'platform.health-check'`
    ),
    check(
      "platform_schedules_status_check",
      sql`${table.status} IN ('enabled','disabled')`
    ),
    check(
      "platform_schedules_name_check",
      sql`length(btrim(${table.name})) BETWEEN 1 AND 100`
    ),
    check("platform_schedules_version_check", sql`${table.version} >= 1`),
    check(
      "platform_schedules_next_check",
      sql`(${table.status}='enabled' AND ${table.nextRunAt} IS NOT NULL) OR (${table.status}='disabled' AND ${table.nextRunAt} IS NULL)`
    ),
  ]
)

export const platformScheduleRuns = pgTable(
  "platform_schedule_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 计划删除不级联清理运行事实；名称、类型及执行身份都是当次快照。
    scheduleId: uuid("schedule_id").notNull(),
    scheduleName: text("schedule_name").notNull(),
    taskType: text("task_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    requestedBy: uuid("requested_by"),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorCode: text("error_code"),
    result: jsonb("result").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("platform_schedule_runs_page_idx").on(
      table.scheduleId,
      table.startedAt,
      table.id
    ),
    uniqueIndex("platform_schedule_runs_running_unique")
      .on(table.scheduleId)
      .where(sql`${table.status}='running'`),
    check(
      "platform_schedule_runs_type_check",
      sql`${table.taskType} = 'platform.health-check'`
    ),
    check(
      "platform_schedule_runs_trigger_check",
      sql`${table.trigger} IN ('automatic','manual')`
    ),
    check(
      "platform_schedule_runs_status_check",
      sql`${table.status} IN ('running','succeeded','failed','rejected')`
    ),
    check(
      "platform_schedule_runs_result_check",
      sql`(${table.status}='running' AND ${table.finishedAt} IS NULL AND ${table.errorCode} IS NULL AND ${table.result} IS NULL) OR (${table.status}='succeeded' AND ${table.finishedAt} IS NOT NULL AND ${table.errorCode} IS NULL AND ${table.result} IS NOT NULL AND jsonb_typeof(${table.result})='object') OR (${table.status} IN ('failed','rejected') AND ${table.finishedAt} IS NOT NULL AND ${table.errorCode} IS NOT NULL AND ${table.result} IS NULL)`
    ),
  ]
)
