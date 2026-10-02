import { z } from "zod"
import { FileVersionReferenceSchema } from "./files.js"

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
const ProjectRichTextMarkSchema = z.discriminatedUnion("type", [
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

// JSON 节点由当前编辑器的正式扩展限定；递归类型只描述该 Schema 的数据形状。
export type ProjectRichTextNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: ProjectRichTextNode[]
  text?: string
  marks?: z.infer<typeof ProjectRichTextMarkSchema>[]
}
const textNode = z.strictObject({
  type: z.literal("text"),
  text: z.string().min(1),
  marks: z.array(ProjectRichTextMarkSchema).optional(),
})
const children: z.ZodType<ProjectRichTextNode[]> = z.lazy(() =>
  z.array(ProjectRichTextNodeSchema)
)
export const ProjectRichTextNodeSchema: z.ZodType<ProjectRichTextNode> = z
  .lazy(() =>
    z.discriminatedUnion("type", [
      textNode,
      z.strictObject({
        type: z.literal("hardBreak"),
        marks: z.array(ProjectRichTextMarkSchema).optional(),
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
        attrs: FileVersionReferenceSchema.extend({ alt: z.string() }),
      }),
      z.strictObject({
        type: z.literal("fileAttachment"),
        attrs: FileVersionReferenceSchema.extend({ label: z.string() }),
      }),
    ])
  )
  .superRefine((node: ProjectRichTextNode, ctx) => {
    const types = node.content?.map((child) => child.type) ?? []
    const blocks = new Set([
      "paragraph",
      "heading",
      "blockquote",
      "bulletList",
      "orderedList",
      "codeBlock",
      "table",
      "fileImage",
      "fileAttachment",
    ])
    let valid = true
    switch (node.type) {
      case "paragraph":
      case "heading":
        valid = types.every((type) => type === "text" || type === "hardBreak")
        break
      case "codeBlock":
        valid =
          types.every((type) => type === "text") &&
          (node.content ?? []).every((child) => !child.marks?.length)
        break
      case "bulletList":
      case "orderedList":
        valid = types.length > 0 && types.every((type) => type === "listItem")
        break
      case "listItem":
        valid =
          types[0] === "paragraph" && types.every((type) => blocks.has(type))
        break
      case "table":
        valid = types.length > 0 && types.every((type) => type === "tableRow")
        break
      case "tableRow":
        valid =
          types.length > 0 &&
          types.every((type) => type === "tableCell" || type === "tableHeader")
        break
      case "blockquote":
      case "tableCell":
      case "tableHeader":
        valid = types.length > 0 && types.every((type) => blocks.has(type))
        break
    }
    if (!valid)
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: "Invalid editor node children",
      })
  })
  .meta({ id: "ProjectRichTextNode" })

export const ProjectRichTextDocumentSchema = z
  .strictObject({ type: z.literal("doc"), content: children })
  .refine(
    (document) =>
      document.content.length > 0 &&
      document.content.every((node) =>
        [
          "paragraph",
          "heading",
          "blockquote",
          "bulletList",
          "orderedList",
          "codeBlock",
          "table",
          "fileImage",
          "fileAttachment",
        ].includes(node.type)
      ),
    { message: "Document requires block nodes" }
  )
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
export const ProjectAttachmentsResponseSchema = z
  .strictObject({
    revision: z.number().int().min(1),
    items: ProjectAttachmentsSchema,
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
