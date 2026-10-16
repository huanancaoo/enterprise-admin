import { ReactNodeViewRenderer } from "@tiptap/react"
import {
  ProjectFileAttachment,
  ProjectFileImage,
} from "@workspace/rich-text/extensions"
import { FileAttachmentView, FileImageView } from "./file-content"

export const FileImage = ProjectFileImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FileImageView)
  },
})

export const FileAttachment = ProjectFileAttachment.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView)
  },
})
