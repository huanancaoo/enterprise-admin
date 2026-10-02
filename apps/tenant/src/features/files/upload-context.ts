import { createContext, useContext } from "react"
import type { FileResponse, FolderResponse } from "@workspace/contracts"

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
