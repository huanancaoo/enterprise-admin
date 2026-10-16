import { z } from "zod"
import { OrganizationIdSchema } from "./identifiers.js"
import { SupportedLocaleSchema, InheritedLocaleSourceSchema } from "./locale.js"

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
