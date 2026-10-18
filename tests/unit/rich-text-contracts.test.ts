import { describe, expect, it } from "vitest"
import { AnnouncementRichTextDocumentSchema } from "../../packages/contracts/src/announcement-content.js"
import { ProjectRichTextDocumentSchema } from "../../packages/contracts/src/project-files.js"
import {
  AnnouncementEditorDocumentSchema,
  ProjectEditorDocumentSchema,
} from "../../packages/rich-text/src/index.js"

const fileId = "8a5a8b2b-0668-4f2a-baa3-e6f793de4f32"
const versionId = "c531e8a7-335a-470a-8845-e3a5b335939f"
const paragraph = {
  type: "paragraph",
  content: [{ type: "text", text: "正文" }],
}
const image = {
  type: "fileImage",
  attrs: { fileId, versionId: fileId, alt: "图片" },
}
const link = (href: string) => ({
  type: "paragraph",
  content: [
    {
      type: "text",
      text: "链接",
      marks: [{ type: "link", attrs: { href } }],
    },
  ],
})
const document = (content: unknown[]) => ({ type: "doc", content })
const schemas = [
  {
    name: "project",
    contract: ProjectRichTextDocumentSchema,
    editor: ProjectEditorDocumentSchema,
  },
  {
    name: "announcement",
    contract: AnnouncementRichTextDocumentSchema,
    editor: AnnouncementEditorDocumentSchema,
  },
]

describe.each(schemas)("$name rich text", ({ contract, editor }) => {
  it("preserves every supported block, mark and structured resource without transforming content", () => {
    const input = document([
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "格式",
            marks: [{ type: "bold" }, { type: "italic" }, { type: "strike" }],
          },
          { type: "hardBreak", marks: [{ type: "bold" }] },
          { type: "text", text: "代码", marks: [{ type: "code" }] },
        ],
      },
      ...[1, 2, 3].map((level) => ({
        type: "heading",
        attrs: { level },
        content: paragraph.content,
      })),
      { type: "blockquote", content: [paragraph] },
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [paragraph] }],
      },
      {
        type: "orderedList",
        attrs: { start: 2, type: "a" },
        content: [{ type: "listItem", content: [paragraph] }],
      },
      {
        type: "codeBlock",
        attrs: { language: null },
        content: [{ type: "text", text: "const value = 1" }],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: ["tableCell", "tableHeader"].map((type) => ({
              type,
              attrs: {
                colspan: 1,
                rowspan: 2,
                colwidth: [120],
                align: "center",
              },
              content: [paragraph],
            })),
          },
        ],
      },
      link("https://example.test"),
      image,
      {
        type: "fileAttachment",
        attrs: { fileId, versionId: fileId, label: "附件" },
      },
    ])
    expect(contract.parse(input)).toEqual(input)
    expect(editor.parse(input)).toEqual(input)
  })

  it("keeps strict recursive node, mark and attribute constraints", () => {
    const invalidNodes = [
      { type: "horizontalRule" },
      { type: "text", text: "" },
      { ...paragraph, attrs: { foreign: true } },
      { type: "heading", attrs: { level: 4 } },
      { type: "heading", attrs: { level: 1, foreign: true } },
      { type: "orderedList", attrs: { start: 0 }, content: [] },
      { type: "codeBlock", attrs: { language: null, foreign: true } },
      {
        type: "tableCell",
        attrs: { colspan: 0, rowspan: 1, colwidth: null },
        content: [],
      },
      {
        type: "tableHeader",
        attrs: { colspan: 1, rowspan: 1, colwidth: [0] },
        content: [],
      },
      {
        type: "text",
        text: "格式",
        marks: [{ type: "bold", attrs: { foreign: true } }],
      },
      {
        type: "text",
        text: "链接",
        marks: [
          {
            type: "link",
            attrs: { href: "https://example.test", foreign: true },
          },
        ],
      },
      { ...image, attrs: { ...image.attrs, src: "blob:temporary" } },
      { ...image, attrs: { ...image.attrs, versionId: "not-a-uuid" } },
      link("javascript:alert(1)"),
      link("/api/v1/organizations/org/files/entries/id"),
    ]
    for (const node of invalidNodes) {
      const input = document([{ type: "blockquote", content: [node] }])
      expect(contract.safeParse(input).success).toBe(false)
      expect(editor.safeParse(input).success).toBe(false)
    }
    expect(
      contract.safeParse({ ...document([paragraph]), foreign: [] }).success
    ).toBe(false)
  })

  it("continues to apply editor syntax validation after the JSON contract", () => {
    for (const content of [
      [],
      [{ type: "paragraph", content: [image] }],
      [{ type: "bulletList", content: [paragraph] }],
      [{ type: "table", content: [paragraph] }],
      [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "重复样式",
              marks: [{ type: "bold" }, { type: "bold" }],
            },
          ],
        },
      ],
    ]) {
      const input = document(content)
      expect(contract.safeParse(input).success).toBe(true)
      expect(editor.safeParse(input).success).toBe(false)
    }
  })
})

describe("rich text business boundaries", () => {
  it("keeps immutable announcement resources distinct from project file versions", () => {
    for (const type of ["fileImage", "fileAttachment"]) {
      const label = type === "fileImage" ? { alt: "图片" } : { label: "附件" }
      const input = document([{ type, attrs: { fileId, versionId, ...label } }])
      expect(ProjectRichTextDocumentSchema.parse(input)).toEqual(input)
      expect(AnnouncementRichTextDocumentSchema.safeParse(input).success).toBe(
        false
      )
    }
  })

  it("keeps each business's private-link filter", () => {
    for (const href of [
      "/api/v1/platform/settings",
      "/api/v1/organizations/org/projects/id",
    ]) {
      const input = document([link(href)])
      expect(ProjectRichTextDocumentSchema.parse(input)).toEqual(input)
      expect(AnnouncementRichTextDocumentSchema.safeParse(input).success).toBe(
        false
      )
    }
  })
})
