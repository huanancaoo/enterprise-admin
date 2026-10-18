import { z } from "zod"
import {
  createRichTextMarkSchema,
  createRichTextNodeVariants,
} from "./rich-text.js"
import {
  FileVersionReferenceSchema,
  FileVersionResponseSchema,
} from "./files.js"

const safeLink = z.string().refine((value) => {
  try {
    const url = new URL(value, "https://project.invalid")
    return (
      [
        "http:",
        "https:",
        "ftp:",
        "ftps:",
        "mailto:",
        "tel:",
        "callto:",
        "sms:",
        "cid:",
        "xmpp:",
      ].includes(url.protocol) &&
      !/^\/api\/v1\/organizations\/[^/]+\/files(?:\/|$)/.test(url.pathname)
    )
  } catch {
    return false
  }
}, "File links must use a structured version reference")
const ProjectRichTextMarkSchema = createRichTextMarkSchema(safeLink)

// 协议只描述 JSON 形状与业务属性；编辑器语法由富文本能力包校验。
export type ProjectRichTextNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: ProjectRichTextNode[]
  text?: string
  marks?: z.infer<typeof ProjectRichTextMarkSchema>[]
}
const children: z.ZodType<ProjectRichTextNode[]> = z.lazy(() =>
  z.array(projectRichTextNodeShape)
)
// 保留严格属性与结构化文件引用，避免将临时授权地址写入持久化文档。
const projectRichTextNodeShape: z.ZodType<ProjectRichTextNode> = z
  .lazy(() =>
    z.discriminatedUnion("type", [
      ...createRichTextNodeVariants(children, ProjectRichTextMarkSchema),
      z.strictObject({
        type: z.literal("fileImage"),
        attrs: FileVersionReferenceSchema.extend({ alt: z.string() }),
      }),
      z.strictObject({
        type: z.literal("fileAttachment"),
        attrs: FileVersionReferenceSchema.extend({ label: z.string() }),
      }),
    ])
  )
  .meta({ id: "ProjectRichTextNode" })

export const ProjectRichTextNodeSchema = projectRichTextNodeShape

export const ProjectRichTextDocumentSchema = z
  .strictObject({ type: z.literal("doc"), content: children })
  .meta({ id: "ProjectRichTextDocument" })
export type ProjectRichTextDocument = z.infer<
  typeof ProjectRichTextDocumentSchema
>

export const ProjectAttachmentsSchema = z.array(FileVersionReferenceSchema)
export const UpdateProjectAttachmentsSchema = z
  .strictObject({
    expectedRevision: z.number().int().min(1),
    items: ProjectAttachmentsSchema,
  })
  .meta({ id: "UpdateProjectAttachments" })
// 项目读者可以了解绑定；内容读取仍由 Files API 的独立授权决定。
export const ProjectAttachmentSchema = FileVersionReferenceSchema.extend({
  name: z.string(),
  bytes: FileVersionResponseSchema.shape.bytes,
  contentType: FileVersionResponseSchema.shape.contentType,
  versionCreatedAt: z.iso.datetime(),
}).meta({ id: "ProjectAttachment" })
export type ProjectAttachment = z.infer<typeof ProjectAttachmentSchema>
export const ProjectAttachmentsResponseSchema = z
  .strictObject({
    revision: z.number().int().min(1),
    items: z.array(ProjectAttachmentSchema),
  })
  .meta({ id: "ProjectAttachmentsResponse" })
export type ProjectAttachmentsResponse = z.infer<
  typeof ProjectAttachmentsResponseSchema
>
export const SaveProjectContentSchema = z
  .strictObject({
    expectedRevision: z.number().int().min(1).nullable(),
    document: ProjectRichTextDocumentSchema,
  })
  .meta({ id: "SaveProjectContent" })
export type SaveProjectContent = z.infer<typeof SaveProjectContentSchema>
