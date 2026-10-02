import { FileHandler } from "@tiptap/extension-file-handler"
import { TableKit } from "@tiptap/extension-table"
import type { Extensions } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"

import { IMAGE_MIME_TYPES } from "./insert-image"
import { FileAttachment, FileImage } from "./file-nodes"

export function createRichTextExtensions(options: {
  onImages?: (files: File[], pos?: number) => void
}): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      underline: false,
      horizontalRule: false,
      trailingNode: false,
      link: { openOnClick: false },
    }),
    FileImage,
    FileAttachment,
    TableKit.configure({ table: { resizable: false } }),
  ]
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
