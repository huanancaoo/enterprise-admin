import {
  FileDownloadButton as Download,
  ProtectedFilePreview as Preview,
  type FileContentTarget,
} from "@workspace/admin/files"
import { useFileContentAccess } from "./queries"
export type { FileContentTarget }
export function FileDownloadButton({ target }: { target: FileContentTarget }) {
  const access = useFileContentAccess()
  return <Download target={target} access={access} />
}
export function ProtectedFilePreview({
  target,
  contentScopeKey,
}: {
  target: FileContentTarget
  contentScopeKey: string
}) {
  const access = useFileContentAccess()
  return (
    <Preview
      target={target}
      contentScopeKey={contentScopeKey}
      access={access}
    />
  )
}
