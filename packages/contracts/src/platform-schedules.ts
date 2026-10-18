import { z } from "zod"
import { PlatformMonitorSchema } from "./platform-monitor.js"

export const PlatformScheduleTypeSchema = z.literal("platform.health-check")
export const PlatformScheduleStatusSchema = z.enum(["enabled", "disabled"])
export const PlatformScheduleRunStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "rejected",
])
export const PlatformScheduleRunErrorSchema = z.enum([
  "FORBIDDEN",
  "AUTHORIZATION_UNAVAILABLE",
  "ACCOUNT_SUSPENDED",
  "ASSIGNMENT_INACTIVE",
  "EXECUTION_FAILED",
  "INTERRUPTED",
])
export const PlatformScheduleIdSchema = z.uuid()
export const PlatformScheduleInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  type: PlatformScheduleTypeSchema,
  cron: z.string().trim().min(9).max(120),
  timeZone: z.string().trim().min(1).max(100),
  status: PlatformScheduleStatusSchema,
})
export const CreatePlatformScheduleSchema = PlatformScheduleInputSchema.meta({
  id: "CreatePlatformSchedule",
})
export const UpdatePlatformScheduleSchema = PlatformScheduleInputSchema.extend({
  expectedVersion: z.number().int().positive(),
}).meta({ id: "UpdatePlatformSchedule" })
export const PlatformScheduleSchema = PlatformScheduleInputSchema.extend({
  id: PlatformScheduleIdSchema,
  createdBy: z.uuid(),
  version: z.number().int().positive(),
  nextRunAt: z.iso.datetime({ offset: true }).nullable(),
  lastRunAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "PlatformSchedule" })
export const PlatformScheduleQuerySchema = z.strictObject({
  q: z.string().trim().max(200).optional(),
  status: PlatformScheduleStatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["createdAt", "name", "nextRunAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
})
export const PlatformSchedulePageSchema = z
  .strictObject({
    items: z.array(PlatformScheduleSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .meta({ id: "PlatformSchedulePage" })
export const PlatformScheduleRunSchema = z
  .strictObject({
    id: z.uuid(),
    scheduleId: z.uuid(),
    scheduleName: z.string(),
    taskType: PlatformScheduleTypeSchema,
    trigger: z.enum(["automatic", "manual"]),
    status: PlatformScheduleRunStatusSchema,
    scheduledAt: z.iso.datetime({ offset: true }).nullable(),
    startedAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }).nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    requestedBy: z.uuid().nullable(),
    errorCode: PlatformScheduleRunErrorSchema.nullable(),
    result: PlatformMonitorSchema.nullable(),
  })
  .meta({ id: "PlatformScheduleRun" })
export const PlatformScheduleRunsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: PlatformScheduleRunStatusSchema.optional(),
})
export const PlatformScheduleRunPageSchema = z
  .strictObject({
    items: z.array(PlatformScheduleRunSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .meta({ id: "PlatformScheduleRunPage" })
export const PlatformScheduleTypesSchema = z
  .array(
    z.strictObject({
      type: PlatformScheduleTypeSchema,
      requiredPermissions: z.array(z.string()),
    })
  )
  .meta({ id: "PlatformScheduleTypes" })
export const DeletePlatformScheduleSchema = z
  .strictObject({ deleted: z.boolean() })
  .meta({ id: "DeletePlatformSchedule" })
export type CreatePlatformSchedule = z.infer<
  typeof CreatePlatformScheduleSchema
>
export type UpdatePlatformSchedule = z.infer<
  typeof UpdatePlatformScheduleSchema
>
export type PlatformSchedule = z.infer<typeof PlatformScheduleSchema>
export type PlatformScheduleQuery = z.infer<typeof PlatformScheduleQuerySchema>
export type PlatformScheduleRun = z.infer<typeof PlatformScheduleRunSchema>
export type PlatformScheduleRunsQuery = z.infer<
  typeof PlatformScheduleRunsQuerySchema
>

export type PlatformSchedulePage = z.infer<typeof PlatformSchedulePageSchema>
export type PlatformScheduleRunPage = z.infer<
  typeof PlatformScheduleRunPageSchema
>
export type PlatformScheduleTypes = z.infer<typeof PlatformScheduleTypesSchema>
