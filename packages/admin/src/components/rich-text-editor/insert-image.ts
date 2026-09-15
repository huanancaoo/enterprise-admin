import type { Editor } from "@tiptap/react"

export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const

export const IMAGE_ACCEPT = IMAGE_MIME_TYPES.join(",")

function isAllowedImage(file: File) {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(file.type)
}

export async function insertUploadedImage(
  editor: Editor,
  file: File,
  onUploadImage: (file: File) => Promise<string>,
  pos?: number
) {
  if (!isAllowedImage(file)) {
    return
  }
  let src: string
  try {
    src = await onUploadImage(file)
  } catch {
    return
  }
  if (pos === undefined) {
    editor.chain().focus().setImage({ src }).run()
    return
  }
  // setImage 没有位置参数，拖放必须插在指针处
  editor
    .chain()
    .focus()
    .insertContentAt(pos, { type: "image", attrs: { src } })
    .run()
}

export async function insertUploadedImages(
  editor: Editor,
  files: File[],
  onUploadImage: (file: File) => Promise<string>,
  pos?: number
) {
  let nextPos = pos
  for (const file of files) {
    const sizeBefore = editor.state.doc.content.size
    await insertUploadedImage(editor, file, onUploadImage, nextPos)
    if (nextPos !== undefined) {
      nextPos += editor.state.doc.content.size - sizeBefore
    }
  }
}
