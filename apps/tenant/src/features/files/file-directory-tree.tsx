import { FileDirectoryTree as Tree } from "@workspace/admin/files"
import type { FolderResponse } from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { getFileFolderChildrenOptions } from "./file-queries"
type Props = {
  organizationId: string
  authorizationVersion: number
  root: FolderResponse
  currentFolderId?: string
  ancestors: FolderResponse[]
  disabled: boolean
  onOpenFolder: (folder: FolderResponse) => void
}
export function FileDirectoryTree({
  organizationId,
  authorizationVersion,
  ...props
}: Props) {
  const locale = useUiLocale()
  return (
    <Tree
      {...props}
      childrenQuery={(id) =>
        getFileFolderChildrenOptions(
          organizationId,
          authorizationVersion,
          id,
          locale
        )
      }
    />
  )
}
