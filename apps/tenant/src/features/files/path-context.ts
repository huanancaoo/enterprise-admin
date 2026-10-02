import { createContext, useContext } from "react"
import type { FileEntryResponse } from "@workspace/contracts"
import type { FilePathAction } from "./use-file-path-operations"

export const PathActionsContext = createContext<{
  pathTriggerId: string
  canPerform: (entry: FileEntryResponse, action: FilePathAction) => boolean
  onAction: (entry: FileEntryResponse, action: FilePathAction) => void
} | null>(null)

export function useFilePathActions() {
  const actions = useContext(PathActionsContext)
  if (!actions) throw new Error("File path actions require FilePathOperations")
  return actions
}
