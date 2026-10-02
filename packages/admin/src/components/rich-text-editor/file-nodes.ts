import { Node, ReactNodeViewRenderer } from "@tiptap/react"
import { FileAttachmentView, FileImageView } from "./file-content"

// 文档只保存不可变版本引用；授权读取产生的临时地址只属于 NodeView。
export const FileImage = Node.create({
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
  addNodeView() {
    return ReactNodeViewRenderer(FileImageView)
  },
})

export const FileAttachment = Node.create({
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
  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView)
  },
})
