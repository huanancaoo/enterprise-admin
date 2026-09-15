import { FileHandler } from "@tiptap/extension-file-handler"
import { Image } from "@tiptap/extension-image"
import { TableKit } from "@tiptap/extension-table"
import type { Extensions } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"

import { IMAGE_MIME_TYPES, insertUploadedImages } from "./insert-image"

export function createRichTextExtensions(options: {
  onUploadImage?: (file: File) => Promise<string>
}): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      underline: false,
      horizontalRule: false,
      trailingNode: false,
      link: { openOnClick: false },
    }),
    Image.configure({
      inline: false,
      allowBase64: false,
      resize: false,
    }),
    TableKit.configure({
      table: { resizable: false },
    }),
  ]

  if (options.onUploadImage) {
    const onUploadImage = options.onUploadImage
    extensions.push(
      FileHandler.configure({
        allowedMimeTypes: [...IMAGE_MIME_TYPES],
        // 否则 Image parseHTML 会把同一份粘贴再插一次
        consumePasteEvent: true,
        onPaste: (editor, files) => {
          void insertUploadedImages(editor, files, onUploadImage)
        },
        onDrop: (editor, files, pos) => {
          void insertUploadedImages(editor, files, onUploadImage, pos)
        },
      })
    )
  }

  return extensions
}
