import { z } from "zod"

export const AccessCredentialIdSchema = z
  .uuid()
  .meta({ id: "AccessCredentialId" })

export const AccessCredentialPermissionsSchema = z
  .record(z.string().min(1), z.array(z.string().min(1)).nonempty())
  .refine((permissions) => Object.keys(permissions).length > 0)
  .meta({ id: "AccessCredentialPermissions" })
export const CreateAccessCredentialSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(64),
    expiresAt: z.iso.datetime({ offset: true }),
    permissions: AccessCredentialPermissionsSchema,
  })
  .meta({ id: "CreateAccessCredential" })
export const AccessCredentialSchema = CreateAccessCredentialSchema.extend({
  id: AccessCredentialIdSchema,
  organizationId: z.uuid(),
  userId: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  enabled: z.boolean(),
}).meta({ id: "AccessCredential" })
export const IssuedAccessCredentialSchema = AccessCredentialSchema.extend({
  key: z.string(),
}).meta({ id: "IssuedAccessCredential" })
export const AccessCredentialListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type AccessCredentialListQuery = z.infer<
  typeof AccessCredentialListQuerySchema
>
export const AccessCredentialListSchema = z
  .strictObject({
    items: z.array(AccessCredentialSchema),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
  })
  .meta({ id: "AccessCredentialList" })
export type CreateAccessCredential = z.infer<
  typeof CreateAccessCredentialSchema
>
export type AccessCredential = z.infer<typeof AccessCredentialSchema>
export type IssuedAccessCredential = z.infer<
  typeof IssuedAccessCredentialSchema
>
export type AccessCredentialList = z.infer<typeof AccessCredentialListSchema>
