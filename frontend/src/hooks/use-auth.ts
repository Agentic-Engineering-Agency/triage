/**
 * Better Auth client hook.
 * Chenko will implement this as part of TRI-4 (Better Auth Setup)
 * and TRI-21 (Auth Pages).
 *
 * This placeholder exports the hook shape so routes can reference it.
 */

export interface User {
  id: string
  email: string
  name: string
}

export interface AuthState {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
}

export function useAuth(): AuthState {
  // TODO: Replace with Better Auth client SDK
  // import { createAuthClient } from "better-auth/react"
  return {
    user: null,
    isLoading: false,
    isAuthenticated: false,
  }
}
