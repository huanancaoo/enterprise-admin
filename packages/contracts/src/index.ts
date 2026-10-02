import { z } from "zod"
import { FileErrorDetailsSchema, fileErrorCodes } from "./files.js"

export * from "./files.js"
export * from "./file-batches.js"
export { maxFileNameBytes, maxFolderNameBytes } from "./file-path.js"
export * from "./platform-storage.js"
export * from "./personal-media.js"

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
export const UserIdSchema = z.uuid()
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

export const OrganizationRoleAccessSchema = z
  .strictObject({
    canRead: z.boolean(),
    canCreate: z.boolean(),
    canUpdate: z.boolean(),
    canDelete: z.boolean(),
    grantablePermissions: z.array(
      z.strictObject({ resource: z.string(), action: z.string() })
    ),
  })
  .meta({ id: "OrganizationRoleAccess" })
export type OrganizationRoleAccess = z.infer<
  typeof OrganizationRoleAccessSchema
>
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
export const AuditResultSchema = z
  .enum(["succeeded", "denied", "failed", "no_change"])
  .meta({ id: "AuditResult" })
export type AuditResult = z.infer<typeof AuditResultSchema>
export const AuditScopeSchema = z
  .enum(["tenant", "platform"])
  .meta({ id: "AuditScope" })
export type AuditScope = z.infer<typeof AuditScopeSchema>
export const AuditEventIdSchema = z.uuid()
export const AuditEventsQuerySchema = z
  .strictObject({
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    actorId: z.uuid().optional(),
    eventCode: z.string().trim().min(1).max(120).optional(),
    resourceType: z.string().trim().min(1).max(80).optional(),
    resourceId: z.uuid().optional(),
    result: AuditResultSchema.optional(),
    cursor: z.string().max(2048).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: "AuditEventsQuery" })
export type AuditEventsQuery = z.infer<typeof AuditEventsQuerySchema>
export const AuditEventCursorSchema = z.strictObject({
  filters: z.strictObject({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    actorId: z.uuid().optional(),
    eventCode: z.string().trim().min(1).max(120).optional(),
    resourceType: z.string().trim().min(1).max(80).optional(),
    resourceId: z.uuid().optional(),
    result: AuditResultSchema.optional(),
    limit: z.number().int().min(1).max(100),
  }),
  before: z.strictObject({
    occurredAt: z.iso.datetime(),
    id: z.uuid(),
  }),
})
export type AuditEventCursor = z.infer<typeof AuditEventCursorSchema>
export const AuditEventSchema = z
  .strictObject({
    id: z.uuid(),
    occurredAt: z.iso.datetime(),
    eventCode: z.string().min(1),
    scope: AuditScopeSchema,
    actorType: z.enum(["user", "deployment_operator", "system"]),
    actorId: z.uuid().nullable(),
    resourceType: z.string().nullable(),
    resourceId: z.uuid().nullable(),
    result: AuditResultSchema,
    publicSummary: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .meta({ id: "AuditEvent" })
export type AuditEvent = z.infer<typeof AuditEventSchema>
export const AuditEventsPageSchema = z
  .strictObject({
    items: z.array(AuditEventSchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: "AuditEventsPage" })
export type AuditEventsPage = z.infer<typeof AuditEventsPageSchema>
export const PlatformAccessSchema = z
  .strictObject({
    userId: z.uuid(),
    role: z.enum(["platform_admin", "platform_auditor"]),
    scope: z.literal("global"),
    mfaVerifiedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "PlatformAccess" })
export type PlatformAccess = z.infer<typeof PlatformAccessSchema>
export const PlatformSettingsSchema = z
  .strictObject({
    platformDefaultLocale: SupportedLocaleSchema,
    version: z.number().int().min(1),
    supportedLocales: z.array(SupportedLocaleSchema),
    environment: z.string(),
    applicationVersion: z.string(),
    smtpConfigured: z.boolean(),
  })
  .meta({ id: "PlatformSettings" })
export type PlatformSettings = z.infer<typeof PlatformSettingsSchema>
export const UpdatePlatformSettingsSchema = z
  .strictObject({
    platformDefaultLocale: SupportedLocaleSchema,
    reason: z.string().trim().min(10).max(500),
    expectedVersion: z.number().int().min(1),
  })
  .meta({ id: "UpdatePlatformSettings" })
export type UpdatePlatformSettings = z.infer<
  typeof UpdatePlatformSettingsSchema
>
export const PlatformSettingsUpdateResultSchema = PlatformSettingsSchema.pick({
  platformDefaultLocale: true,
  version: true,
})
  .extend({
    changed: z.boolean(),
    result: z.enum(["succeeded", "no_change"]),
    operationId: z.uuid(),
  })
  .meta({ id: "PlatformSettingsUpdateResult" })
export type PlatformSettingsUpdateResult = z.infer<
  typeof PlatformSettingsUpdateResultSchema
>
// 两个审计事实源保留各自身份，避免相同 UUID 在列表和详情中产生歧义。
export const PlatformAuditEventIdSchema = z
  .string()
  .regex(
    /^(event|assignment):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  )
export const PlatformAuditQuerySchema = z.strictObject({
  purpose: z.string().trim().min(1).max(500),
  organizationId: OrganizationIdSchema.optional(),
  actorId: UserIdSchema.optional(),
  eventCode: z.string().trim().min(1).max(120).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  result: AuditResultSchema.optional(),
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
export type PlatformAuditQuery = z.infer<typeof PlatformAuditQuerySchema>
export const PlatformAuditCursorSchema = z.strictObject({
  audience: z.literal("platform-audit"),
  filters: PlatformAuditQuerySchema.omit({
    purpose: true,
    cursor: true,
  }).extend({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    limit: z.number().int().min(1).max(100),
  }),
  before: z.strictObject({
    occurredAt: z.iso.datetime({ offset: true }),
    id: PlatformAuditEventIdSchema,
  }),
})
export type PlatformAuditCursor = z.infer<typeof PlatformAuditCursorSchema>

export const PlatformAuditPurposeSchema = PlatformAuditQuerySchema.pick({
  purpose: true,
})
export const PlatformAuditEventSchema = z
  .strictObject({
    id: PlatformAuditEventIdSchema,
    occurredAt: z.iso.datetime({ offset: true }),
    scope: z.enum(["tenant", "platform", "user", "security"]),
    targetOrganization: z
      .strictObject({
        organizationId: OrganizationIdSchema,
        name: z.string().nullable(),
      })
      .nullable(),
    eventCode: z.string(),
    actorType: z.enum(["user", "deployment_operator", "system"]),
    actorId: UserIdSchema.nullable(),
    actorMaskedEmail: z.string().nullable(),
    resourceType: z.string().nullable(),
    resourceId: z.uuid().nullable(),
    result: AuditResultSchema,
    metadata: z.strictObject({
      previousRole: z
        .enum(["platform_admin", "platform_auditor"])
        .nullable()
        .optional(),
      nextRole: z
        .enum(["platform_admin", "platform_auditor"])
        .nullable()
        .optional(),
    }),
  })
  .meta({ id: "PlatformAuditEvent" })
export type PlatformAuditEvent = z.infer<typeof PlatformAuditEventSchema>
export const PlatformAuditPageSchema = z
  .strictObject({
    items: z.array(PlatformAuditEventSchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: "PlatformAuditPage" })
export type PlatformAuditPage = z.infer<typeof PlatformAuditPageSchema>
export const PlatformUsersQuerySchema = z.strictObject({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(2_147_483_647).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type PlatformUsersQuery = z.infer<typeof PlatformUsersQuerySchema>
export const PlatformUserSchema = z
  .strictObject({
    userId: z.uuid(),
    name: z.string(),
    maskedEmail: z.string(),
    emailVerified: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
    organizationCount: z.number().int().min(0),
  })
  .meta({ id: "PlatformUser" })
export const PlatformUsersPageSchema = z
  .strictObject({
    items: z.array(PlatformUserSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .meta({ id: "PlatformUsersPage" })
export type PlatformUsersPage = z.infer<typeof PlatformUsersPageSchema>
export const PlatformUserDetailSchema = PlatformUserSchema.extend({
  twoFactorEnabled: z.boolean(),
  organizations: z.array(
    z.strictObject({
      organizationId: z.uuid(),
      name: z.string(),
      slug: z.string(),
      status: OrganizationStatusSchema,
      role: z.string(),
      joinedAt: z.iso.datetime({ offset: true }),
    })
  ),
}).meta({ id: "PlatformUserDetail" })
export type PlatformUserDetail = z.infer<typeof PlatformUserDetailSchema>
export const SensitiveProfileQuerySchema = z.strictObject({
  purpose: z.string().trim().min(1).max(500),
})
export type SensitiveProfileQuery = z.infer<typeof SensitiveProfileQuerySchema>
export const PlatformSensitiveProfileSchema = z
  .strictObject({
    userId: z.uuid(),
    email: z.email(),
  })
  .meta({ id: "PlatformSensitiveProfile" })
export type PlatformSensitiveProfile = z.infer<
  typeof PlatformSensitiveProfileSchema
>
export const PlatformOrganizationQuerySchema = z.strictObject({
  q: z.string().trim().max(200).optional(),
  status: OrganizationStatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(2_147_483_647).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(["name", "slug", "createdAt", "memberCount"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
})
export type PlatformOrganizationQuery = z.infer<
  typeof PlatformOrganizationQuerySchema
>
export const PlatformOrganizationSchema = OrganizationSummarySchema.extend({
  createdAt: z.iso.datetime({ offset: true }),
  memberCount: z.number().int().min(0),
  version: z.number().int().min(1),
}).meta({ id: "PlatformOrganization" })
export const PlatformOrganizationPageSchema = z
  .strictObject({
    items: z.array(PlatformOrganizationSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .meta({ id: "PlatformOrganizationPage" })
export type PlatformOrganizationPage = z.infer<
  typeof PlatformOrganizationPageSchema
>
export const PlatformOrganizationDetailSchema =
  PlatformOrganizationSchema.extend({
    defaultLocale: SupportedLocaleSchema.nullable(),
    statusChangedAt: z.iso.datetime({ offset: true }),
    members: z.array(
      z.strictObject({ role: z.string(), count: z.number().int().min(0) })
    ),
    history: z.array(
      z.strictObject({
        id: z.uuid(),
        occurredAt: z.iso.datetime({ offset: true }),
        eventCode: z.enum([
          "platform.organization_suspended",
          "platform.organization_resumed",
        ]),
        actorId: z.uuid().nullable(),
        result: AuditResultSchema,
        operationId: z.string(),
      })
    ),
  }).meta({ id: "PlatformOrganizationDetail" })
export type PlatformOrganizationDetail = z.infer<
  typeof PlatformOrganizationDetailSchema
>
export const TransitionOrganizationSchema = z
  .strictObject({
    reason: z.string().trim().min(10).max(500),
    expectedVersion: z.number().int().min(1).max(2_147_483_647),
  })
  .meta({ id: "TransitionOrganization" })
export type TransitionOrganization = z.infer<
  typeof TransitionOrganizationSchema
>
export const IdempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/)
export const OrganizationTransitionResultSchema = z
  .strictObject({
    organizationId: OrganizationIdSchema,
    status: OrganizationStatusSchema,
    version: z.number().int().min(1),
    changed: z.boolean(),
    result: z.enum(["succeeded", "no_change"]),
    operationId: z.uuid(),
  })
  .meta({ id: "OrganizationTransitionResult" })
export type OrganizationTransitionResult = z.infer<
  typeof OrganizationTransitionResultSchema
>
export const ApiErrorCodeSchema = z
  .enum([
    "VALIDATION_ERROR",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "PLATFORM_MFA_REQUIRED",
    "NOT_FOUND",
    "ORGANIZATION_SUSPENDED",
    "AUTHORIZATION_UNAVAILABLE",
    "AUDIT_UNAVAILABLE",
    "VERSION_CONFLICT",
    "IDEMPOTENCY_KEY_REUSED",
    "PERSONAL_MEDIA_OPERATION_EXPIRED",
    "PERSONAL_MEDIA_CONTENT_MISMATCH",
    ...fileErrorCodes,
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
    details: FileErrorDetailsSchema.optional(),
  })
  .meta({ id: "ApiError" })
export type ApiError = z.infer<typeof ApiErrorSchema>
