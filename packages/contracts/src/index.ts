import { z } from "zod"

export const SupportedLocaleSchema = z.enum(["zh-CN", "en-US", "ar"])
export type SupportedLocale = z.infer<typeof SupportedLocaleSchema>
export const OrganizationIdSchema = z.uuidv4()
export const ProjectIdSchema = z.uuid()
export const ProjectStatusSchema = z.enum(["draft", "active", "archived"])
export const ProjectListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: ProjectStatusSchema.optional(),
  name: z.string().trim().optional(),
  sortBy: z.enum(["createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
})
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>
export const CreateProjectSchema = z.strictObject({
  name: z.string().trim().min(1),
  description: z.string().nullable(),
  contentLocale: SupportedLocaleSchema.optional(),
})
export type CreateProject = z.infer<typeof CreateProjectSchema>
export const UpdateProjectTranslationSchema = z
  .strictObject({
    locale: SupportedLocaleSchema,
    name: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
  })
  .refine(
    (translation) =>
      translation.name !== undefined || translation.description !== undefined,
    { message: "At least one translation field is required" }
  )
export type UpdateProjectTranslation = z.infer<
  typeof UpdateProjectTranslationSchema
>
export const UpdateProjectSchema = z
  .strictObject({
    status: ProjectStatusSchema.optional(),
    translation: UpdateProjectTranslationSchema.optional(),
  })
  .refine(
    (project) =>
      project.status !== undefined || project.translation !== undefined,
    { message: "At least one project field is required" }
  )
export type UpdateProject = z.infer<typeof UpdateProjectSchema>
export const ProjectTranslationResponseSchema = z.strictObject({
  locale: SupportedLocaleSchema,
  name: z.string().min(1),
  description: z.string().nullable(),
})
export type ProjectTranslationResponse = z.infer<
  typeof ProjectTranslationResponseSchema
>
export const ProjectResponseSchema = z.strictObject({
  id: z.uuid(),
  organizationId: OrganizationIdSchema,
  status: ProjectStatusSchema,
  contentLocale: SupportedLocaleSchema,
  resolvedLocale: SupportedLocaleSchema,
  name: z.string().min(1),
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>
export const ProjectPageSchema = z.strictObject({
  items: z.array(ProjectResponseSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
})
export type ProjectPage = z.infer<typeof ProjectPageSchema>
export const ApiErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INTERNAL_ERROR",
])
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>
export const ApiErrorSchema = z.strictObject({
  code: ApiErrorCodeSchema,
  message: z.string(),
  requestId: z.string().min(1),
  locale: SupportedLocaleSchema,
})
export type ApiError = z.infer<typeof ApiErrorSchema>
