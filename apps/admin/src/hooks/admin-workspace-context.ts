import { createContext, useContext } from "react"
import type { useOrganizationWorkspace } from "./use-organization-workspace"

export const AdminWorkspaceContext = createContext<ReturnType<
  typeof useOrganizationWorkspace
> | null>(null)

export function useAdminWorkspace() {
  return useContext(AdminWorkspaceContext)!
}
