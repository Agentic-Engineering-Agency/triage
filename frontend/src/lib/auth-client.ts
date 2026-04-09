/**
 * Better Auth client SDK — configured to match backend auth at /auth.
 * In dev mode, Vite proxy forwards /auth/* to localhost:4111.
 */
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:3001",
  basePath: "/auth",
})

export const { signIn, signUp, signOut } = authClient
