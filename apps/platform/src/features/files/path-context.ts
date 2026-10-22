import { createContext, useContext } from "react"
import type { FileEntryView as FileEntryResponse } from "@workspace/admin/files"
import type { FilePathAction } from "@workspace/admin/files"

export const PathActionsContext = createContext<{
  pathTriggerId: string
  canShow: (entry: FileEntryResponse, action: FilePathAction) => boolean
  canPerform: (entry: FileEntryResponse, action: FilePathAction) => boolean
  onAction: (entry: FileEntryResponse, action: FilePathAction) => void
} | null>(null)

export function useFilePathActions() {
  const actions = useContext(PathActionsContext)
  if (!actions) throw new Error("File path actions require FilePathOperations")
  return actions
}
