import { describe, expect, it } from "vitest"
import { createRequire } from "node:module"
import { createRichTextExtensions } from "../../packages/admin/src/components/rich-text-editor/extensions.js"
const requireAdmin = createRequire(
  new URL("../../packages/admin/package.json", import.meta.url)
)
const { getSchema } = requireAdmin("@tiptap/react")
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  ProjectRichTextDocumentSchema,
  SaveProjectContentSchema,
  ProjectAttachmentSchema,
} from "../../packages/contracts/src/index.js"

const fileId = "8a5a8b2b-0668-4f2a-baa3-e6f793de4f32"
const versionId = "c531e8a7-335a-470a-8845-e3a5b335939f"
const paragraph = {
  type: "paragraph",
  content: [{ type: "text", text: "摘要保持纯文本" }],
}
const image = { type: "fileImage", attrs: { fileId, versionId, alt: "图片" } }
const document = { type: "doc", content: [paragraph, image] }

describe("Projects attachments and editor document contracts", () => {
  it("keeps summary text and makes attachments an explicit CAS field", () => {
    expect(
      CreateProjectSchema.parse({
        name: "项目",
        description: "<b>纯文本</b>",
        attachments: [{ fileId, versionId }],
      }).description
    ).toBe("<b>纯文本</b>")
    expect(
      UpdateProjectSchema.parse({
        attachments: { expectedRevision: 1, items: [] },
      })
    ).toEqual({ attachments: { expectedRevision: 1, items: [] } })
    expect(
      UpdateProjectSchema.safeParse({ attachments: [{ fileId, versionId }] })
        .success
    ).toBe(false)
    expect(
      UpdateProjectSchema.safeParse({ attachments: { items: [] } }).success
    ).toBe(false)
    expect(
      CreateProjectSchema.safeParse({
        name: "项目",
        description: null,
        attachments: [{ fileId, versionId, url: "blob:temporary" }],
      }).success
    ).toBe(false)
  })
  it("requires bound version metadata in reads while writes stay UUID references", () => {
    const item = {
      fileId,
      versionId,
      name: "合同.pdf",
      bytes: 0,
      contentType: "application/pdf",
      versionCreatedAt: "2026-10-02T00:00:00.000Z",
    }
    expect(ProjectAttachmentSchema.parse(item)).toEqual(item)
    expect(
      ProjectAttachmentSchema.safeParse({ fileId, versionId }).success
    ).toBe(false)
    expect(
      ProjectAttachmentSchema.safeParse({ ...item, storagePath: ["private"] })
        .success
    ).toBe(false)
    expect(
      CreateProjectSchema.safeParse({
        name: "项目",
        description: null,
        attachments: [item],
      }).success
    ).toBe(false)
  })
  it("accepts current editor blocks, marks, tables and structured file nodes", () => {
    const table = {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [paragraph],
            },
          ],
        },
      ],
    }
    const list = {
      type: "orderedList",
      attrs: { start: 2 },
      content: [{ type: "listItem", content: [paragraph] }],
    }
    const link = {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "公开网站",
          marks: [
            {
              type: "link",
              attrs: {
                href: "https://example.test",
                target: "_blank",
                rel: "noopener noreferrer nofollow",
                class: null,
              },
            },
            { type: "bold" },
          ],
        },
      ],
    }
    const input = {
      expectedRevision: null,
      document: {
        type: "doc",
        content: [
          paragraph,
          image,
          table,
          list,
          link,
          {
            type: "fileAttachment",
            attrs: { fileId, versionId, label: "合同" },
          },
        ],
      },
    }
    expect(SaveProjectContentSchema.parse(input)).toEqual(input)
    const json = SaveProjectContentSchema["~standard"].jsonSchema.input({
      target: "openapi-3.0",
    })
    expect(json).toBeDefined()
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
    expect(ProjectRichTextDocumentSchema.parse(json)).toEqual(json)
  })
  it("rejects persistent image URLs, foreign attributes, hidden reference lists and unsupported node structures", () => {
    for (const node of [
      { type: "image", attrs: { src: "https://public.test/file.png" } },
      { ...image, attrs: { ...image.attrs, src: "blob:temporary" } },
      { ...image, attrs: { ...image.attrs, versionId: "elsewhere" } },
      { type: "heading", attrs: { level: 4 }, content: [] },
      { type: "horizontalRule" },
      { type: "paragraph", content: [image] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "文件",
            marks: [
              {
                type: "link",
                attrs: { href: "/api/v1/organizations/org/files/entries/id" },
              },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "脚本",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
          },
        ],
      },
    ])
      expect(
        ProjectRichTextDocumentSchema.safeParse({
          type: "doc",
          content: [node],
        }).success
      ).toBe(false)
    expect(
      SaveProjectContentSchema.safeParse({
        expectedRevision: null,
        document,
        references: [],
      }).success
    ).toBe(false)
    expect(
      ProjectRichTextDocumentSchema.safeParse({
        type: "doc",
        content: [paragraph],
        references: [],
      }).success
    ).toBe(false)
  })
})
