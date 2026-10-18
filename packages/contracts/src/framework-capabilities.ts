import { z } from "zod"
import { InvitationImportSummarySchema } from "./organization-invitations.js"
import { ProjectListQuerySchema } from "./project-query.js"

export const ExchangeFormatSchema = z.enum(["csv", "xlsx"])
export const PROJECT_IMPORT_MAX_BYTES = 10_000_000
export const ProjectExportFilterSchema = ProjectListQuerySchema.omit({
  page: true,
  pageSize: true,
})
export const CreateProjectExportSchema = z
  .strictObject({
    format: ExchangeFormatSchema,
    filter: ProjectExportFilterSchema,
  })
  .meta({ id: "CreateProjectExport" })
export const CreateProjectImportSchema = z
  .strictObject({
    format: ExchangeFormatSchema,
    contentBase64: z
      .string()
      .max(Math.ceil(PROJECT_IMPORT_MAX_BYTES / 3) * 4)
      .refine((value) => z.base64().safeParse(value).success, "Invalid base64")
      .refine(
        (value) =>
          (value.length / 4) * 3 -
            (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0) <=
          PROJECT_IMPORT_MAX_BYTES,
        "Import file exceeds 10 MB"
      ),
  })
  .meta({ id: "CreateProjectImport" })
export type CreateProjectExport = z.infer<typeof CreateProjectExportSchema>
export type CreateProjectImport = z.infer<typeof CreateProjectImportSchema>

export const CapabilityPageQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type CapabilityPageQuery = z.infer<typeof CapabilityPageQuerySchema>
export const ImportIssueSchema = z.strictObject({
  row: z
    .number()
    .int()
    .min(1)
    .describe("CSV record starting text line or XLSX worksheet row"),
  field: z.enum(["name", "description", "contentLocale", "file"]),
  code: z.enum([
    "INVALID_NAME",
    "INVALID_DESCRIPTION",
    "INVALID_LOCALE",
    "INVALID_COLUMNS",
    "INVALID_FILE",
    "INVALID_WORKSHEET_COUNT",
  ]),
})
export const BusinessTaskResultSchema = z
  .strictObject({
    count: z.number().int().min(0),
    issues: z.array(ImportIssueSchema),
    invitationImport: InvitationImportSummarySchema.optional(),
  })
  .meta({ id: "BusinessTaskResult" })
export type BusinessTaskResult = z.infer<typeof BusinessTaskResultSchema>
export type ImportIssue = z.infer<typeof ImportIssueSchema>
export const BusinessTaskIdSchema = z.uuid()
export const BusinessTaskErrorCodeSchema = z.enum([
  "TOO_MANY_ROWS",
  "IMPORT_VALIDATION_FAILED",
  "MEMBERSHIP_REQUIRED",
  "PERMISSION_DENIED",
  "ORGANIZATION_SUSPENDED",
  "RESOURCE_DENIED",
  "EXECUTION_FAILED",
])
export const BusinessTaskSchema = z
  .strictObject({
    id: z.uuid(),
    organizationId: z.uuid(),
    actorId: z.uuid(),
    type: z.enum([
      "projects.import",
      "projects.export",
      "members.export",
      "audit.export",
      "invitations.import",
    ]),
    status: z.enum([
      "submitted",
      "queued",
      "running",
      "completed",
      "failed",
      "rejected",
    ]),
    format: ExchangeFormatSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    errorCode: BusinessTaskErrorCodeSchema.nullable(),
    result: BusinessTaskResultSchema.nullable(),
    resultAvailable: z.boolean(),
  })
  .meta({ id: "BusinessTask" })
export type BusinessTask = z.infer<typeof BusinessTaskSchema>
export const BusinessTaskPageSchema = z
  .strictObject({
    items: z.array(BusinessTaskSchema),
    total: z.number().int().min(0),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .meta({ id: "BusinessTaskPage" })
export const TaskCenterItemSchema = z
  .strictObject({
    id: z.string(),
    source: z.enum(["business", "file-upload", "file-path", "file-batch"]),
    type: z.string(),
    actorId: z.uuid(),
    status: z.string().nullable(),
    states: z
      .array(
        z.strictObject({ state: z.string(), count: z.number().int().min(0) })
      )
      .nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    resultAvailable: z.boolean(),
    errorCode: z.string().nullable(),
  })
  .meta({ id: "TaskCenterItem" })
export const TaskCenterPageSchema = z
  .strictObject({
    items: z.array(TaskCenterItemSchema),
    visibility: z.enum(["own", "organization"]),
    total: z.number().int().min(0),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .meta({ id: "TaskCenterPage" })

export const NotificationSchema = z
  .strictObject({
    id: z.uuid(),
    organizationId: z.uuid(),
    recipientId: z.uuid(),
    type: z.enum(["task.completed", "task.failed"]),
    taskId: z.uuid(),
    taskType: z.enum([
      "projects.import",
      "projects.export",
      "members.export",
      "audit.export",
      "invitations.import",
    ]),
    createdAt: z.iso.datetime(),
    readAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "Notification" })
export const NotificationPageSchema = z
  .strictObject({
    items: z.array(NotificationSchema),
    total: z.number().int().min(0),
    unreadCount: z.number().int().min(0),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .meta({ id: "NotificationPage" })
export const NotificationPreferencesSchema = z
  .strictObject({ emailEnabled: z.boolean() })
  .meta({ id: "NotificationPreferences" })

export const webhookEventTypes = [
  "project.created",
  "project.updated",
  "project.deleted",
  "task.completed",
  "task.failed",
] as const
export const WebhookEventTypeSchema = z.enum(webhookEventTypes)
export const CreateWebhookSchema = z
  .strictObject({
    name: z.string().trim().min(1),
    url: z
      .url()
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
    events: z.array(WebhookEventTypeSchema).min(1),
  })
  .meta({ id: "CreateWebhook" })
export const UpdateWebhookSchema = CreateWebhookSchema.extend({
  enabled: z.boolean(),
}).meta({ id: "UpdateWebhook" })
export const WebhookSchema = z
  .strictObject({
    id: z.uuid(),
    organizationId: z.uuid(),
    name: z.string(),
    url: z.url(),
    events: z.array(WebhookEventTypeSchema),
    enabled: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "Webhook" })
export const CreatedWebhookSchema = WebhookSchema.extend({
  signingSecret: z.string(),
}).meta({ id: "CreatedWebhook" })
export const WebhookListSchema = z
  .array(WebhookSchema)
  .meta({ id: "WebhookList" })
export const WebhookDeliverySchema = z
  .strictObject({
    id: z.uuid(),
    webhookId: z.uuid(),
    eventId: z.uuid(),
    eventType: WebhookEventTypeSchema,
    status: z.enum(["pending", "delivered", "failed"]),
    attempts: z.number().int(),
    lastStatusCode: z.number().int().nullable(),
    nextAttemptAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    deliveredAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "WebhookDelivery" })
export const WebhookDeliveryPageSchema = z
  .strictObject({
    items: z.array(WebhookDeliverySchema),
    total: z.number().int().min(0),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .meta({ id: "WebhookDeliveryPage" })
export type CreateWebhook = z.infer<typeof CreateWebhookSchema>
export type UpdateWebhook = z.infer<typeof UpdateWebhookSchema>
