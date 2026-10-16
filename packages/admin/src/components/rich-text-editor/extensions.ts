import { FileHandler } from "@tiptap/extension-file-handler"
import type { Extensions } from "@tiptap/react"
import { createProjectRichTextExtensions } from "@workspace/rich-text/extensions"

import { IMAGE_MIME_TYPES } from "./insert-image"
import { FileAttachment, FileImage } from "./file-nodes"

export function createRichTextExtensions(options: {
  onImages?: (files: File[], pos?: number) => void
}): Extensions {
  const extensions = createProjectRichTextExtensions().map((extension) => {
    if (extension.name === FileImage.name) return FileImage
    if (extension.name === FileAttachment.name) return FileAttachment
    return extension
  })
  if (options.onImages) {
    const onImages = options.onImages
    extensions.push(
      FileHandler.configure({
        allowedMimeTypes: [...IMAGE_MIME_TYPES],
        // 避免同一次粘贴同时被 HTML 解析和文件处理器插入。
        consumePasteEvent: true,
        onPaste: (_editor, files) => onImages(files),
        onDrop: (_editor, files, pos) => onImages(files, pos),
      })
    )
  }
  return extensions
}
