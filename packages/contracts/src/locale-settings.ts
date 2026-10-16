import { z } from "zod"
import { OrganizationIdSchema } from "./identifiers.js"
import { SupportedLocaleSchema, LocaleSourceSchema } from "./locale.js"

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
