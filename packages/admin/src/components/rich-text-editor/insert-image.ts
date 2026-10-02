import type { Editor } from "@tiptap/react"
import {
  FileVersionReferenceSchema,
  type FileVersionReference,
} from "@workspace/contracts"

export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const

export const IMAGE_ACCEPT = IMAGE_MIME_TYPES.join(",")

export type ImageUploadStage = "transmitting" | "saving" | "confirming"
export type ImageUploadOptions = {
  signal: AbortSignal
  onStage: (stage: ImageUploadStage) => void
}
export type UploadImage = (
  file: File,
  options: ImageUploadOptions
) => Promise<FileVersionReference>

export function isAllowedImage(file: File) {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(file.type)
}

export function insertFileImage(
  editor: Editor,
  reference: FileVersionReference,
  alt: string,
  pos?: number
) {
  const attrs = { ...FileVersionReferenceSchema.parse(reference), alt }
  const content = { type: "fileImage", attrs }
  if (pos === undefined) {
    editor.chain().focus().insertContent(content).run()
  } else {
    editor.chain().focus().insertContentAt(pos, content).run()
  }
}
