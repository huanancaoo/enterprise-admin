import { getSchema } from "@tiptap/core"
import type { z } from "zod"
import {
  ProjectRichTextDocumentSchema,
  SaveProjectContentSchema,
} from "@workspace/contracts/project-files"
import { createProjectRichTextExtensions } from "./extensions.js"
import { AnnouncementRichTextDocumentSchema } from "@workspace/contracts/platform-announcements"

const editorSchema = getSchema(createProjectRichTextExtensions())

function validateEditorStructure(document: unknown, ctx: z.RefinementCtx) {
  try {
    editorSchema.nodeFromJSON(document).check()
  } catch {
    ctx.addIssue({ code: "custom", message: "Invalid editor node structure" })
  }
}

// 语法校验只在富文本入口执行；通用 HTTP 契约无需加载编辑器运行时。
export const ProjectEditorDocumentSchema =
  ProjectRichTextDocumentSchema.superRefine(validateEditorStructure)

export const SaveProjectEditorContentSchema = SaveProjectContentSchema.extend({
  document: ProjectEditorDocumentSchema,
}).meta({ id: "SaveProjectContent" })

// 编辑器节点语法共用；项目文件与公告资源的归属由各自的内容契约和领域入口校验。
export const AnnouncementEditorDocumentSchema =
  AnnouncementRichTextDocumentSchema.superRefine(validateEditorStructure)
