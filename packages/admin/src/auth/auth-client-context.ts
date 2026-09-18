import { createContext, useContext } from "react"
import type { WorkspaceAuthClient } from "./client"

export const AuthClientContext = createContext<WorkspaceAuthClient | null>(null)

export function useWorkspaceAuthClient() {
  const client = useContext(AuthClientContext)
  if (!client) throw new Error("AuthGate is required")
  return client
}
