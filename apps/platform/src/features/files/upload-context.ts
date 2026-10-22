import type { FolderView as FolderResponse } from "@workspace/admin/files"
import { createContext, useContext } from "react"
import type { FileView as FileResponse } from "@workspace/admin/files"

export type UploadActions = {
  uploadTriggerId: string
  onUpload: (parent: FolderResponse) => void
  onOverwrite: (file: FileResponse) => void
}
export const UploadActionsContext = createContext<UploadActions | null>(null)
export function useFileUploadActions() {
  const actions = useContext(UploadActionsContext)
  if (!actions)
    throw new Error("File upload actions require the scoped upload provider")
  return actions
}
