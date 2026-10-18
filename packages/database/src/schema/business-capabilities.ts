import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import { organization, user } from "./auth.ts"

export const businessTasks = pgTable(
  "business_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => user.id),
    type: text("type").notNull(),
    status: text("status").notNull().default("submitted"),
    format: text("format").notNull(),
    locale: text("locale").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    jobId: text("job_id").notNull(),
    intentFingerprint: text("intent_fingerprint").notNull(),
    requestId: text("request_id").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    resultContent: text("result_content"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("business_tasks_intent_unique").on(
      table.organizationId,
      table.actorId,
      table.type,
      table.idempotencyKey
    ),
    unique("business_tasks_tenant_id_unique").on(
      table.organizationId,
      table.id
    ),
    unique("business_tasks_job_unique").on(table.jobId),
    index("business_tasks_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
      table.id
    ),
    check(
      "business_tasks_type_check",
      sql`${table.type} IN ('projects.import', 'projects.export', 'members.export', 'audit.export', 'invitations.import')`
    ),
    check(
      "business_tasks_status_check",
      sql`${table.status} IN ('submitted', 'queued', 'running', 'completed', 'failed', 'rejected')`
    ),
    check(
      "business_tasks_format_check",
      sql`${table.format} IN ('csv', 'xlsx')`
    ),
    check(
      "business_tasks_locale_check",
      sql`${table.locale} IN ('zh-CN', 'en-US', 'ar')`
    ),
  ]
)

export const businessNotifications = pgTable(
  "business_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => user.id),
    taskId: uuid("task_id").notNull(),
    taskType: text("task_type").notNull(),
    type: text("type").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    emailStatus: text("email_status").notNull().default("pending"),
    emailAttempts: integer("email_attempts").notNull().default(0),
    emailLeaseToken: uuid("email_lease_token"),
    emailLeaseUntil: timestamp("email_lease_until", { withTimezone: true }),
    emailNextAttemptAt: timestamp("email_next_attempt_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.taskId],
      foreignColumns: [businessTasks.organizationId, businessTasks.id],
      name: "business_notifications_tenant_task_fk",
    }),
    unique("business_notifications_task_recipient_unique").on(
      table.taskId,
      table.recipientId
    ),
    index("business_notifications_recipient_created_idx").on(
      table.organizationId,
      table.recipientId,
      table.createdAt
    ),
    check(
      "business_notifications_type_check",
      sql`${table.type} IN ('task.completed', 'task.failed')`
    ),
    check(
      "business_notifications_email_status_check",
      sql`${table.emailStatus} IN ('pending', 'sent', 'disabled', 'failed')`
    ),
  ]
)

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    emailEnabled: boolean("email_enabled").notNull().default(false),
  },
  (table) => [
    unique("notification_preferences_user_unique").on(
      table.organizationId,
      table.userId
    ),
  ]
)

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => user.id),
    name: text("name").notNull(),
    url: text("url").notNull(),
    events: jsonb("events").$type<string[]>().notNull(),
    signingSecret: text("signing_secret").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("webhook_endpoints_tenant_id_unique").on(
      table.organizationId,
      table.id
    ),
  ]
)

export const domainEvents = pgTable(
  "domain_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    actorId: uuid("actor_id").notNull(),
    type: text("type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("domain_events_tenant_id_unique").on(table.organizationId, table.id),
    index("domain_events_organization_created_idx").on(
      table.organizationId,
      table.createdAt
    ),
  ]
)

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    webhookId: uuid("webhook_id").notNull(),
    eventId: uuid("event_id").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastStatusCode: integer("last_status_code"),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
    }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.webhookId],
      foreignColumns: [webhookEndpoints.organizationId, webhookEndpoints.id],
      name: "webhook_deliveries_tenant_endpoint_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.eventId],
      foreignColumns: [domainEvents.organizationId, domainEvents.id],
      name: "webhook_deliveries_tenant_event_fk",
    }),
    unique("webhook_deliveries_event_endpoint_unique").on(
      table.webhookId,
      table.eventId
    ),
    check(
      "webhook_deliveries_status_check",
      sql`${table.status} IN ('pending', 'delivered', 'failed')`
    ),
    check("webhook_deliveries_attempts_check", sql`${table.attempts} >= 0`),
  ]
)
