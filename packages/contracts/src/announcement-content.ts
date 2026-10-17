import { z } from "zod"

// 公告资源不可覆盖；资源 ID 同时标识唯一内容版本，不引用任何租户项目文件。
export const AnnouncementResourceReferenceSchema = z
  .strictObject({
    fileId: z.uuid(),
    versionId: z.uuid(),
  })
  .refine(
    (value) => value.fileId === value.versionId,
    "Resource version must match immutable resource"
  )

const safeLink = z.string().refine((value) => {
  try {
    const url = new URL(value, "https://announcement.invalid")
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
      !/^\/api\/v1\/(?:organizations|platform)\//.test(url.pathname)
    )
  } catch {
    return false
  }
}, "Private resources must use structured references")
const AnnouncementRichTextMarkSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("bold") }),
  z.strictObject({ type: z.literal("italic") }),
  z.strictObject({ type: z.literal("strike") }),
  z.strictObject({ type: z.literal("code") }),
  z.strictObject({
    type: z.literal("link"),
    attrs: z.strictObject({
      href: safeLink,
      target: z
        .enum(["_blank", "_self", "_parent", "_top"])
        .nullable()
        .optional(),
      rel: z.string().nullable().optional(),
      class: z.string().nullable().optional(),
    }),
  }),
])

// 协议只描述 JSON 形状与业务属性；编辑器语法由富文本能力包校验。
type AnnouncementMark = z.infer<typeof AnnouncementRichTextMarkSchema>
type AnnouncementReference = z.infer<typeof AnnouncementResourceReferenceSchema>
interface ContainerNode<K extends string> {
  type: K
  content: AnnouncementRichTextNode[]
}
interface TableCellNode<K extends string> {
  type: K
  attrs: {
    colspan: number
    rowspan: number
    colwidth: number[] | null
    align?: "left" | "center" | "right" | null
  }
  content: AnnouncementRichTextNode[]
}
export type AnnouncementRichTextNode =
  | { type: "text"; text: string; marks?: AnnouncementMark[] }
  | { type: "hardBreak"; marks?: AnnouncementMark[] }
  | { type: "paragraph"; content?: AnnouncementRichTextNode[] }
  | {
      type: "heading"
      attrs: { level: 1 | 2 | 3 }
      content?: AnnouncementRichTextNode[]
    }
  | ContainerNode<"blockquote">
  | ContainerNode<"bulletList">
  | ContainerNode<"listItem">
  | ContainerNode<"table">
  | ContainerNode<"tableRow">
  | {
      type: "orderedList"
      attrs?: { start: number; type?: "1" | "a" | "A" | "i" | "I" | null }
      content: AnnouncementRichTextNode[]
    }
  | {
      type: "codeBlock"
      attrs?: { language: string | null }
      content?: AnnouncementRichTextNode[]
    }
  | TableCellNode<"tableCell">
  | TableCellNode<"tableHeader">
  | { type: "fileImage"; attrs: AnnouncementReference & { alt: string } }
  | { type: "fileAttachment"; attrs: AnnouncementReference & { label: string } }

const textNode = z.strictObject({
  type: z.literal("text"),
  text: z.string().min(1),
  marks: z.array(AnnouncementRichTextMarkSchema).optional(),
})
const children: z.ZodType<AnnouncementRichTextNode[]> = z.lazy(() =>
  z.array(announcementRichTextNodeShape)
)
// 保留严格属性与结构化文件引用，避免将临时授权地址写入持久化文档。
const announcementRichTextNodeShape: z.ZodType<AnnouncementRichTextNode> = z
  .lazy(() =>
    z.discriminatedUnion("type", [
      textNode,
      z.strictObject({
        type: z.literal("hardBreak"),
        marks: z.array(AnnouncementRichTextMarkSchema).optional(),
      }),
      z.strictObject({
        type: z.literal("paragraph"),
        content: children.optional(),
      }),
      z.strictObject({
        type: z.literal("heading"),
        attrs: z.strictObject({
          level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        }),
        content: children.optional(),
      }),
      z.strictObject({ type: z.literal("blockquote"), content: children }),
      z.strictObject({ type: z.literal("bulletList"), content: children }),
      z.strictObject({
        type: z.literal("orderedList"),
        attrs: z
          .strictObject({
            start: z.number().int().min(1),
            type: z.enum(["1", "a", "A", "i", "I"]).nullable().optional(),
          })
          .optional(),
        content: children,
      }),
      z.strictObject({ type: z.literal("listItem"), content: children }),
      z.strictObject({
        type: z.literal("codeBlock"),
        attrs: z.strictObject({ language: z.string().nullable() }).optional(),
        content: children.optional(),
      }),
      z.strictObject({ type: z.literal("table"), content: children }),
      z.strictObject({ type: z.literal("tableRow"), content: children }),
      ...(["tableCell", "tableHeader"] as const).map((type) =>
        z.strictObject({
          type: z.literal(type),
          attrs: z.strictObject({
            colspan: z.number().int().min(1),
            rowspan: z.number().int().min(1),
            colwidth: z.array(z.number().int().positive()).nullable(),
            align: z.enum(["left", "center", "right"]).nullable().optional(),
          }),
          content: children,
        })
      ),
      z.strictObject({
        type: z.literal("fileImage"),
        attrs: AnnouncementResourceReferenceSchema.safeExtend({
          alt: z.string(),
        }),
      }),
      z.strictObject({
        type: z.literal("fileAttachment"),
        attrs: AnnouncementResourceReferenceSchema.safeExtend({
          label: z.string(),
        }),
      }),
    ])
  )
  .meta({ id: "AnnouncementRichTextNode" })

export const AnnouncementRichTextNodeSchema = announcementRichTextNodeShape

export const AnnouncementRichTextDocumentSchema = z
  .strictObject({ type: z.literal("doc"), content: children })
  .meta({ id: "AnnouncementRichTextDocument" })
export type AnnouncementRichTextDocument = z.infer<
  typeof AnnouncementRichTextDocumentSchema
>
