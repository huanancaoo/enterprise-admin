import { z } from "zod"
import {
  AnnouncementResourceReferenceSchema,
  AnnouncementRichTextDocumentSchema,
} from "./announcement-content.js"
export * from "./announcement-content.js"

const paging = {
  page: z.coerce.number().int().min(1).max(2_147_483_647).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}
export const AnnouncementTypeSchema = z.enum(["notice", "announcement"])
export const AnnouncementStatusSchema = z.enum([
  "draft",
  "published",
  "withdrawn",
])
export const AnnouncementAudienceSchema = z.enum([
  "platform",
  "allTenants",
  "organizations",
])
export const AnnouncementQuerySchema = z.strictObject({
  ...paging,
  q: z.string().trim().max(200).optional(),
  type: AnnouncementTypeSchema.optional(),
  status: AnnouncementStatusSchema.optional(),
})
export type AnnouncementQuery = z.infer<typeof AnnouncementQuerySchema>
export const AnnouncementInboxQuerySchema = z.strictObject({
  ...paging,
  q: z.string().trim().max(200).optional(),
  unreadOnly: z.enum(["true", "false"]).optional(),
})
export type AnnouncementInboxQuery = z.infer<
  typeof AnnouncementInboxQuerySchema
>
export const AnnouncementSummarySchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  type: AnnouncementTypeSchema,
  status: AnnouncementStatusSchema,
  audience: AnnouncementAudienceSchema,
  version: z.number().int().min(1),
  publicationId: z.uuid().nullable(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  authorName: z.string().nullable(),
})
export type AnnouncementSummary = z.infer<typeof AnnouncementSummarySchema>
export const AnnouncementAttachmentSchema =
  AnnouncementResourceReferenceSchema.safeExtend({
    fileId: z.uuid(),
    versionId: z.uuid(),
    name: z.string(),
    mimeType: z.string(),
    byteSize: z.number().int().min(0),
  })
export const AnnouncementDetailSchema = AnnouncementSummarySchema.extend({
  content: AnnouncementRichTextDocumentSchema,
  attachments: z.array(AnnouncementAttachmentSchema),
  organizationIds: z.array(z.uuid()),
})
export type AnnouncementDetail = z.infer<typeof AnnouncementDetailSchema>
export const AnnouncementPageSchema = z.strictObject({
  items: z.array(AnnouncementSummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
})
export const AnnouncementInboxItemSchema = AnnouncementSummarySchema.extend({
  unread: z.boolean(),
})
export const AnnouncementInboxPageSchema = AnnouncementPageSchema.extend({
  items: z.array(AnnouncementInboxItemSchema),
  unreadCount: z.number().int().min(0),
})
export const AnnouncementReadingSchema = AnnouncementInboxItemSchema.extend({
  content: AnnouncementRichTextDocumentSchema,
  attachments: z.array(AnnouncementAttachmentSchema),
})
export type AnnouncementReading = z.infer<typeof AnnouncementReadingSchema>
const fields = {
  title: z.string().trim().min(1).max(200),
  type: AnnouncementTypeSchema,
  audience: AnnouncementAudienceSchema,
  organizationIds: z.array(z.uuid()),
  content: AnnouncementRichTextDocumentSchema,
  attachments: z.array(AnnouncementResourceReferenceSchema),
}
function validAudience(value: { audience: string; organizationIds: string[] }) {
  return value.audience === "organizations"
    ? value.organizationIds.length > 0
    : value.organizationIds.length === 0
}
export const CreateAnnouncementSchema = z
  .strictObject(fields)
  .refine(validAudience, {
    message: "Select organizations only for an organization audience",
    path: ["organizationIds"],
  })
  .meta({ id: "CreateAnnouncement" })
export type CreateAnnouncement = z.infer<typeof CreateAnnouncementSchema>
export const UpdateAnnouncementSchema = z
  .strictObject({
    ...fields,
    expectedVersion: z.number().int().min(1),
  })
  .refine(validAudience, {
    message: "Select organizations only for an organization audience",
    path: ["organizationIds"],
  })
  .meta({ id: "UpdateAnnouncement" })
export type UpdateAnnouncement = z.infer<typeof UpdateAnnouncementSchema>
export const AnnouncementVersionSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
})
export const PublishAnnouncementSchema = z
  .strictObject({
    expectedVersion: z.number().int().min(1),
    audience: AnnouncementAudienceSchema,
    organizationIds: z.array(z.uuid()),
  })
  .refine(validAudience, {
    message: "Select organizations only for an organization audience",
    path: ["organizationIds"],
  })
export const ReadAnnouncementSchema = z.strictObject({
  publicationId: z.uuid(),
})
export const AnnouncementReadResultSchema = z.strictObject({
  publicationId: z.uuid(),
  readAt: z.iso.datetime({ offset: true }),
})
export const AnnouncementReadersPageSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      userId: z.uuid(),
      name: z.string().nullable(),
      maskedEmail: z.string().nullable(),
      readAt: z.iso.datetime({ offset: true }),
    })
  ),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
})
export const AnnouncementMediaUploadSchema = z.strictObject({
  file: z
    .file()
    .max(100 * 1024 ** 2)
    .meta({ format: "binary" }),
})
export const AnnouncementMediaQuerySchema = z.strictObject({
  versionId: z.uuid(),
})
export const AnnouncementDeletedSchema = z.strictObject({
  id: z.uuid(),
  deleted: z.literal(true),
})
