import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { authClient } from "@/lib/auth-client"
import { apiFetch } from "@/lib/api"

export const Route = createFileRoute("/register")({
  component: RegisterPage,
})

function RegisterPage() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Redirect authenticated users to /chat
  if (isAuthenticated) {
    navigate({ to: "/chat" })
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const result = await authClient.signUp.email({
        name,
        email,
        password,
      })

      if (result.error) {
        if (result.error.message?.toLowerCase().includes("already") || result.error.code === "USER_ALREADY_EXISTS") {
          setError("An account with this email already exists")
        } else if (result.error.message?.toLowerCase().includes("password")) {
          setError(result.error.message)
        } else {
          setError(result.error.message || "Registration failed. Please try again.")
        }
      } else {
        // Initialize default project for new user
        try {
          const projectRes = await apiFetch('/projects/init-default', { method: 'POST' }) as { success?: boolean; data?: { id?: string } };
          if (projectRes?.success && projectRes?.data?.id) {
            localStorage.setItem('activeProjectId', projectRes.data.id);
          }
        } catch (err) {
          console.warn('Failed to initialize default project:', err);
          // Continue anyway — project might exist or will be created later
        }
        navigate({ to: "/chat" })
      }
    } catch (err) {
      setError("Unable to connect. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background dark:bg-background">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-neu-raised">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-3xl font-bold text-foreground">
            Triage
          </h1>
          <p className="font-sans mt-2 text-sm text-muted-foreground">
            Create your account
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="name"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-xl border border-input bg-muted/50 px-4 py-2.5 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-ring/40"
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-input bg-muted/50 px-4 py-2.5 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-ring/40"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-input bg-muted/50 px-4 py-2.5 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-ring/40"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-lg transition-all hover:bg-primary/90 disabled:opacity-50"
          >
            {isSubmitting ? "Creating Account..." : "Create Account"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-medium text-primary hover:underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
