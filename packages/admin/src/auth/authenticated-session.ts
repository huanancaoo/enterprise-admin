import { createContext, useContext } from "react"

export type AuthenticatedSession = {
  user: {
    id: string
    name: string
    email: string
    image?: string | null
    lastLoginMethod?: string | null
  }
  signOut: () => void
  signingOut: boolean
  signOutError?: string
}

export const AuthenticatedSessionContext =
  createContext<AuthenticatedSession | null>(null)

export function useAuthenticatedSession() {
  return useContext(AuthenticatedSessionContext)
}
