import { z } from "zod"

export const SupportedLocaleSchema = z
  .enum(["zh-CN", "en-US", "ar"])
  .meta({ id: "SupportedLocale" })
export const LocaleSourceSchema = z
  .enum(["request", "user", "organization", "platform"])
  .meta({ id: "LocaleSource" })
export const InheritedLocaleSourceSchema = z
  .enum(["user", "organization", "platform"])
  .meta({ id: "InheritedLocaleSource" })
export type SupportedLocale = z.infer<typeof SupportedLocaleSchema>
export const OrganizationIdSchema = z.uuidv4()
export const ProjectIdSchema = z.uuid()
export const ProjectStatusSchema = z
  .enum(["draft", "active", "archived"])
  .meta({ id: "ProjectStatus" })
export const ProjectListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: ProjectStatusSchema.optional(),
  name: z.string().trim().optional(),
  sortBy: z.enum(["createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
})
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>
export const CreateProjectSchema = z
  .strictObject({
    name: z.string().trim().min(1),
    description: z.string().nullable(),
    contentLocale: SupportedLocaleSchema.optional(),
  })
  .meta({ id: "CreateProject" })
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
  .meta({ id: "UpdateProjectTranslation" })
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
  .meta({ id: "UpdateProject" })
export type UpdateProject = z.infer<typeof UpdateProjectSchema>
export const ProjectTranslationResponseSchema = z
  .strictObject({
    locale: SupportedLocaleSchema,
    name: z.string().min(1),
    description: z.string().nullable(),
  })
  .meta({ id: "ProjectTranslationResponse" })
export type ProjectTranslationResponse = z.infer<
  typeof ProjectTranslationResponseSchema
>
export const ProjectResponseSchema = z
  .strictObject({
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
  .meta({ id: "ProjectResponse" })
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>
export const ProjectPageSchema = z
  .strictObject({
    items: z.array(ProjectResponseSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .meta({ id: "ProjectPage" })
export type ProjectPage = z.infer<typeof ProjectPageSchema>
export const OrganizationStatusSchema = z
  .enum(["ACTIVE", "SUSPENDED"])
  .meta({ id: "OrganizationStatus" })
export type OrganizationStatus = z.infer<typeof OrganizationStatusSchema>
export const OrganizationSummarySchema = z
  .strictObject({
    id: OrganizationIdSchema,
    name: z.string().min(1),
    slug: z.string().min(1),
    status: OrganizationStatusSchema,
  })
  .meta({ id: "OrganizationSummary" })
export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>
export const OrganizationListSchema = z.array(OrganizationSummarySchema)
export type OrganizationList = z.infer<typeof OrganizationListSchema>
export const OrganizationAccessSchema = z
  .strictObject({
    organizationId: OrganizationIdSchema,
    status: z.literal("ACTIVE"),
    authorizationVersion: z.number().int().min(1),
    effectiveLocale: SupportedLocaleSchema,
    effectiveLocaleSource: InheritedLocaleSourceSchema,
  })
  .meta({ id: "OrganizationAccess" })
export type OrganizationAccess = z.infer<typeof OrganizationAccessSchema>
export const MyPreferencesSchema = z
  .strictObject({
    preferredLocale: SupportedLocaleSchema.nullable(),
    version: z.number().int().min(1),
    effectiveLocale: SupportedLocaleSchema,
    effectiveLocaleSource: LocaleSourceSchema,
  })
  .meta({ id: "MyPreferences" })
export type MyPreferences = z.infer<typeof MyPreferencesSchema>
export const UpdateMyPreferencesSchema = z
  .strictObject({
    preferredLocale: SupportedLocaleSchema.nullable(),
    expectedVersion: z.number().int().min(1),
  })
  .meta({ id: "UpdateMyPreferences" })
export type UpdateMyPreferences = z.infer<typeof UpdateMyPreferencesSchema>
export const OrganizationSettingsSchema = z
  .strictObject({
    organizationId: OrganizationIdSchema,
    defaultLocale: SupportedLocaleSchema.nullable(),
    version: z.number().int().min(1),
  })
  .meta({ id: "OrganizationSettings" })
export type OrganizationSettings = z.infer<typeof OrganizationSettingsSchema>
export const UpdateOrganizationSettingsSchema = z
  .strictObject({
    defaultLocale: SupportedLocaleSchema.nullable(),
    expectedVersion: z.number().int().min(1),
  })
  .meta({ id: "UpdateOrganizationSettings" })
export type UpdateOrganizationSettings = z.infer<
  typeof UpdateOrganizationSettingsSchema
>
export const PlatformAccessSchema = z
  .strictObject({
    userId: z.uuid(),
  })
  .meta({ id: "PlatformAccess" })
export type PlatformAccess = z.infer<typeof PlatformAccessSchema>
export const ApiErrorCodeSchema = z
  .enum([
    "VALIDATION_ERROR",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "NOT_FOUND",
    "ORGANIZATION_SUSPENDED",
    "AUTHORIZATION_UNAVAILABLE",
    "VERSION_CONFLICT",
    "INTERNAL_ERROR",
  ])
  .meta({ id: "ApiErrorCode" })
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>
export const ApiErrorSchema = z
  .strictObject({
    code: ApiErrorCodeSchema,
    message: z.string(),
    requestId: z.string().min(1),
    locale: SupportedLocaleSchema,
  })
  .meta({ id: "ApiError" })
export type ApiError = z.infer<typeof ApiErrorSchema>
