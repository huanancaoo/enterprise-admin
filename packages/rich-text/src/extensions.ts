import { Node, type Extensions } from "@tiptap/core"
import { TableKit } from "@tiptap/extension-table"
import StarterKit from "@tiptap/starter-kit"

// 编辑器命令依靠声明合并；构建后的子路径入口仍须加载同源扩展的类型声明。
export type {} from "@tiptap/starter-kit"
export type {} from "@tiptap/extension-table"

// 文档只保存不可变版本引用；授权读取产生的临时地址只属于编辑器的 NodeView。
export const ProjectFileImage = Node.create({
  name: "fileImage",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      fileId: { default: null },
      versionId: { default: null },
      alt: { default: "" },
    }
  },
  parseHTML() {
    return [{ tag: "figure[data-file-image]" }]
  },
  renderHTML({ HTMLAttributes }) {
    return ["figure", { ...HTMLAttributes, "data-file-image": "" }]
  },
})

export const ProjectFileAttachment = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      fileId: { default: null },
      versionId: { default: null },
      label: { default: "" },
    }
  },
  parseHTML() {
    return [{ tag: "div[data-file-attachment]" }]
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-file-attachment": "" }]
  },
})

// 保存校验与编辑器共用扩展配置，避免 marks 排斥、节点组合等语法各自演进。
export function createProjectRichTextExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      underline: false,
      horizontalRule: false,
      trailingNode: false,
      link: { openOnClick: false },
    }),
    ProjectFileImage,
    ProjectFileAttachment,
    TableKit.configure({ table: { resizable: false } }),
  ]
}
