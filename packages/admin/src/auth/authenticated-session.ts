import { createContext, useContext } from "react"

export type AuthenticatedSession = {
  user: {
    name: string
    email: string
    image?: string | null
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
