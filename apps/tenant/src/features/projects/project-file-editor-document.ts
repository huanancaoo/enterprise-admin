import type { JSONContent } from "@workspace/admin"
import {
  FileVersionReferenceSchema,
  type FileVersionReference,
} from "@workspace/contracts"

export type ProjectFileNode = {
  path: number[]
  type: "fileImage" | "fileAttachment"
  reference: FileVersionReference
  label: string
}
export const projectImageContentTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const
export function projectFileNodes(document: JSONContent): ProjectFileNode[] {
  const items: ProjectFileNode[] = []
  const visit = (node: JSONContent, path: number[]) => {
    if (node.type === "fileImage" || node.type === "fileAttachment") {
      const reference = FileVersionReferenceSchema.safeParse({
        fileId: node.attrs?.fileId,
        versionId: node.attrs?.versionId,
      })
      if (reference.success)
        items.push({
          path,
          type: node.type,
          reference: reference.data,
          label: String(
            node.attrs?.[node.type === "fileImage" ? "alt" : "label"] ?? ""
          ),
        })
    }
    node.content?.forEach((child, index) => visit(child, [...path, index]))
  }
  document.content?.forEach((node, index) => visit(node, [index]))
  return items
}
export function replaceProjectFileNode(
  document: JSONContent,
  selected: ProjectFileNode,
  replacement: FileVersionReference | null,
  label = selected.label
): JSONContent {
  const next = structuredClone(document)
  let parent = next
  for (const index of selected.path.slice(0, -1))
    parent = parent.content![index]!
  const index = selected.path.at(-1)!
  const node = parent.content?.[index]
  if (
    node?.type !== selected.type ||
    node.attrs?.fileId !== selected.reference.fileId ||
    node.attrs?.versionId !== selected.reference.versionId
  )
    throw new Error("Reference node changed")
  // 替换空段落保留原生编辑器的有效 block 结构；解除引用不会删除文件或其版本。
  parent.content![index] = replacement
    ? {
        type: selected.type,
        attrs: {
          ...replacement,
          [selected.type === "fileImage" ? "alt" : "label"]: label,
        },
      }
    : { type: "paragraph" }
  return next
}
