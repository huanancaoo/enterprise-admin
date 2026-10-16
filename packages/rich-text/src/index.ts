import { getSchema } from "@tiptap/core"
import {
  ProjectRichTextDocumentSchema,
  SaveProjectContentSchema,
} from "@workspace/contracts/project-files"
import { createProjectRichTextExtensions } from "./extensions.js"

const editorSchema = getSchema(createProjectRichTextExtensions())

// 语法校验只在富文本入口执行；通用 HTTP 契约无需加载编辑器运行时。
export const ProjectEditorDocumentSchema =
  ProjectRichTextDocumentSchema.superRefine((document, ctx) => {
    try {
      editorSchema.nodeFromJSON(document).check()
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Invalid editor node structure",
      })
    }
  })

export const SaveProjectEditorContentSchema = SaveProjectContentSchema.extend({
  document: ProjectEditorDocumentSchema,
}).meta({ id: "SaveProjectContent" })
