import { z } from "zod"
import { OrganizationIdSchema, UserIdSchema } from "./identifiers.js"
import { SupportedLocaleSchema } from "./locale.js"
import { AuditResultSchema } from "./audit.js"
import {
  OrganizationStatusSchema,
  OrganizationSummarySchema,
} from "./organizations.js"

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
