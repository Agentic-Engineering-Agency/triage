/**
 * Better Auth session hook.
 * Wraps authClient.useSession() from Better Auth React SDK.
 */
import { authClient, signIn, signUp, signOut } from "@/lib/auth-client"

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
  const session = authClient.useSession()

  const user: User | null = session.data?.user
    ? {
        id: session.data.user.id,
        email: session.data.user.email,
        name: session.data.user.name,
      }
    : null

  return {
    user,
    isLoading: session.isPending,
    isAuthenticated: !!session.data?.user,
  }
}

export { signIn, signUp, signOut }
