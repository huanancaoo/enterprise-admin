import { createContext, useContext } from "react"
import type { ExecuteFileBatch, FileEntryResponse } from "@workspace/contracts"

export const BatchActionsContext = createContext<{
  triggerId: string
  available: boolean
  onBatch: (
    entries: readonly FileEntryResponse[],
    action: ExecuteFileBatch["action"]
  ) => void
} | null>(null)

export function useFileBatchActions() {
  const actions = useContext(BatchActionsContext)
  if (!actions) throw new Error("File batch actions require FileBatches")
  return actions
}
