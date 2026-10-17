import { z } from "zod"

export const PlatformExportResourceSchema = z.enum([
  "employees",
  "roles",
  "menus",
  "departments",
  "posts",
  "dictionaries",
  "dictionary-items",
  "parameters",
  "users",
  "organizations",
  "login-events",
  "sessions",
  "audit-events",
])
export type PlatformExportResource = z.infer<
  typeof PlatformExportResourceSchema
>
const optionalString = z.string().trim().max(200).optional()
export const PlatformExportFiltersSchema = z.strictObject({
  q: optionalString,
  status: optionalString,
  departmentId: z.uuid().optional(),
  roleId: z.uuid().optional(),
  dictionaryId: z.uuid().optional(),
  parentId: z.uuid().nullable().optional(),
  sortBy: optionalString,
  sortOrder: z.enum(["asc", "desc"]).optional(),
  method: optionalString,
  result: optionalString,
  userId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  eventCode: optionalString,
  organizationId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
})
export type PlatformExportFilters = z.infer<typeof PlatformExportFiltersSchema>
const exportFilterKeys: Record<PlatformExportResource, readonly string[]> = {
  employees: ["q", "status", "departmentId", "roleId", "sortBy", "sortOrder"],
  roles: ["q", "status", "sortBy", "sortOrder"],
  menus: ["q", "status", "parentId"],
  departments: ["q", "status", "parentId"],
  posts: ["q", "status", "sortBy", "sortOrder"],
  dictionaries: ["q", "status", "sortBy", "sortOrder"],
  "dictionary-items": ["q", "status", "sortBy", "sortOrder", "dictionaryId"],
  parameters: ["q", "status", "sortBy", "sortOrder"],
  users: ["q"],
  organizations: ["q", "status", "sortBy", "sortOrder"],
  "login-events": ["q", "userId", "result", "method", "from", "to"],
  sessions: ["q", "userId"],
  "audit-events": [
    "organizationId",
    "actorId",
    "eventCode",
    "result",
    "from",
    "to",
  ],
}
export const CreatePlatformExportTaskSchema = z
  .strictObject({
    resource: PlatformExportResourceSchema,
    filters: PlatformExportFiltersSchema.default({}),
  })
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value.filters)) {
      if (!exportFilterKeys[value.resource].includes(key))
        ctx.addIssue({
          code: "custom",
          path: ["filters", key],
          message: "Filter is not supported by this resource",
        })
    }
    if (value.resource === "dictionary-items" && !value.filters.dictionaryId)
      ctx.addIssue({
        code: "custom",
        path: ["filters", "dictionaryId"],
        message: "Dictionary is required",
      })
  })
  .meta({ id: "CreatePlatformExportTask" })
export type CreatePlatformExportTask = z.infer<
  typeof CreatePlatformExportTaskSchema
>
export const CreatePlatformEmployeeImportTaskSchema = z
  .strictObject({
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/\.xlsx$/i),
    contentBase64: z
      .string()
      .min(4)
      .max(13_981_016)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
      ),
    initialPassword: z.string().min(12).max(128),
    updateExisting: z.boolean(),
  })
  .meta({ id: "CreatePlatformEmployeeImportTask" })
export type CreatePlatformEmployeeImportTask = z.infer<
  typeof CreatePlatformEmployeeImportTaskSchema
>
export const PlatformTaskIdSchema = z.uuid()
export const PlatformTaskQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(2_147_483_647).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type PlatformTaskQuery = z.infer<typeof PlatformTaskQuerySchema>
export const PlatformTaskResultSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  granted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  issues: z.array(
    z.strictObject({
      rowNumber: z.number().int().positive(),
      code: z.string().regex(/^[A-Z_]{1,100}$/),
    })
  ),
})
export type PlatformTaskResult = z.infer<typeof PlatformTaskResultSchema>
export const PlatformTaskSchema = z
  .strictObject({
    id: z.uuid(),
    actorId: z.uuid(),
    kind: z.enum(["export", "employee-import"]),
    resource: PlatformExportResourceSchema,
    status: z.enum([
      "pending",
      "queued",
      "running",
      "completed",
      "failed",
      "rejected",
    ]),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    errorCode: z
      .string()
      .regex(/^[A-Z_]{1,100}$/)
      .nullable(),
    resultAvailable: z.boolean(),
    result: PlatformTaskResultSchema.nullable(),
  })
  .meta({ id: "PlatformTask" })
export type PlatformTask = z.infer<typeof PlatformTaskSchema>
export const PlatformTaskPageSchema = z
  .strictObject({
    items: z.array(PlatformTaskSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  })
  .meta({ id: "PlatformTaskPage" })
