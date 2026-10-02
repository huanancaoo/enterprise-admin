import { z } from "zod"

const contentUrlSchema = z
  .string()
  .regex(
    /^\/api\/v1\/personal-media\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/content$/
  )

export const personalMediaMaximumBytes = 5 * 1024 * 1024
export const PersonalMediaIdSchema = z.uuid()
export const PersonalMediaUploadKeySchema = z.uuid()
export const PersonalMediaContentTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
])
export const PersonalMediaSchema = z
  .strictObject({
    id: PersonalMediaIdSchema,
    bytes: z.number().int().min(1).max(personalMediaMaximumBytes),
    contentType: PersonalMediaContentTypeSchema,
    contentUrl: contentUrlSchema,
    createdAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: "PersonalMedia" })
export type PersonalMedia = z.infer<typeof PersonalMediaSchema>
export const PersonalMediaUploadResultSchema = z
  .strictObject({
    operationId: z.uuid(),
    media: PersonalMediaSchema,
    result: z.literal("succeeded"),
  })
  .meta({ id: "PersonalMediaUploadResult" })
export type PersonalMediaUploadResult = z.infer<
  typeof PersonalMediaUploadResultSchema
>
export const SetPersonalAvatarSchema = z
  .strictObject({
    mediaId: PersonalMediaIdSchema.nullable(),
    // expectedImage 只用于比较；历史 URL 也必须能被用户明确移除。
    expectedImage: z.string().max(512).nullable(),
    idempotencyKey: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9:_-]+$/),
  })
  .meta({ id: "SetPersonalAvatar" })
export type SetPersonalAvatar = z.infer<typeof SetPersonalAvatarSchema>
export const PersonalAvatarResultSchema = z
  .strictObject({
    image: contentUrlSchema.nullable(),
    changed: z.boolean(),
    result: z.enum(["succeeded", "no_change"]),
    operationId: z.uuid(),
  })
  .meta({ id: "PersonalAvatarResult" })
export type PersonalAvatarResult = z.infer<typeof PersonalAvatarResultSchema>
// 查询必须内联展开，Nest 才能生成实际 query 参数。
export const PersonalMediaContentQuerySchema = z.strictObject({
  organizationId: z.uuidv4().optional(),
})
export type PersonalMediaContentQuery = z.infer<
  typeof PersonalMediaContentQuerySchema
>
