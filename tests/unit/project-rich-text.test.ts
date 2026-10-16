import { describe, expect, it } from "vitest"
import { createRequire } from "node:module"
import { createRichTextExtensions } from "../../packages/admin/src/components/rich-text-editor/extensions.js"
import {
  ProjectEditorDocumentSchema,
  SaveProjectEditorContentSchema,
} from "../../packages/rich-text/src/index.js"
import { SaveProjectContentSchema } from "../../packages/contracts/dist/index.js"

const requireAdmin = createRequire(
  new URL("../../packages/admin/package.json", import.meta.url)
)
const { getSchema } = requireAdmin("@tiptap/react")
const fileId = "8a5a8b2b-0668-4f2a-baa3-e6f793de4f32"
const versionId = "c531e8a7-335a-470a-8845-e3a5b335939f"
const paragraph = {
  type: "paragraph",
  content: [{ type: "text", text: "摘要保持纯文本" }],
}
const image = { type: "fileImage", attrs: { fileId, versionId, alt: "图片" } }

describe("Shared official rich text schema", () => {
  it("preserves the JSON protocol shape when adding runtime syntax validation", () => {
    expect(
      SaveProjectEditorContentSchema["~standard"].jsonSchema.input({
        target: "draft-2020-12",
      })
    ).toEqual(
      SaveProjectContentSchema["~standard"].jsonSchema.input({
        target: "draft-2020-12",
      })
    )
  })
  it("accepts actual editor schema serialization including native defaults and styled line breaks", () => {
    const schema = getSchema(createRichTextExtensions({}))
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [{ type: "listItem", content: [paragraph] }],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [{ type: "tableCell", content: [paragraph] }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "第一行", marks: [{ type: "bold" }] },
            { type: "hardBreak", marks: [{ type: "bold" }] },
            { type: "text", text: "第二行", marks: [{ type: "bold" }] },
          ],
        },
        { type: "codeBlock" },
        image,
        { type: "fileAttachment", attrs: { fileId, versionId } },
      ],
    })
    doc.check()
    const json = doc.toJSON()
    expect(ProjectEditorDocumentSchema.parse(json)).toEqual(json)
  })
  it("rejects invalid editor syntax through the same schema used by the editor", () => {
    const schema = getSchema(createRichTextExtensions({}))
    const textWithMarks = (types: string[]) => ({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "无效样式组合",
          marks: types.map((type) => ({ type })),
        },
      ],
    })
    for (const content of [
      [],
      [textWithMarks(["bold", "code"])],
      [textWithMarks(["bold", "bold"])],
      [{ type: "paragraph", content: [image] }],
      [{ type: "bulletList", content: [paragraph] }],
      [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [image] }],
        },
      ],
      [{ type: "table", content: [paragraph] }],
      [
        {
          type: "table",
          content: [{ type: "tableRow", content: [paragraph] }],
        },
      ],
      [{ type: "blockquote", content: [] }],
      [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "code", marks: [{ type: "bold" }] }],
        },
      ],
    ]) {
      const invalidDocument = { type: "doc", content }
      expect(() => schema.nodeFromJSON(invalidDocument).check()).toThrow()
      expect(
        ProjectEditorDocumentSchema.safeParse(invalidDocument).success
      ).toBe(false)
      expect(
        SaveProjectEditorContentSchema.safeParse({
          expectedRevision: null,
          document: invalidDocument,
        }).success
      ).toBe(false)
    }
  })
  it("keeps business attributes strict where ProseMirror only validates syntax", () => {
    const schema = getSchema(createRichTextExtensions({}))
    for (const attrs of [
      { ...image.attrs, versionId: "not-a-uuid" },
      { ...image.attrs, src: "blob:temporary" },
    ]) {
      const input = { type: "doc", content: [{ ...image, attrs }] }
      expect(() => schema.nodeFromJSON(input).check()).not.toThrow()
      expect(ProjectEditorDocumentSchema.safeParse(input).success).toBe(false)
    }
  })
})
