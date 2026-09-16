import { createContext, use } from "react"
import type { DataTableStatus } from "./types"

export const DataTablePresentationContext = createContext<{
  status: DataTableStatus
  isActionPending: boolean
  rowsDisabled: boolean
} | null>(null)

export function useDataTablePresentation() {
  const context = use(DataTablePresentationContext)
  if (!context) throw new Error("DataTable components require DataTable")
  return context
}
