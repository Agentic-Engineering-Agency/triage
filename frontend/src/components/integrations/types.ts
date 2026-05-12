/**
 * Shared types for the integrations API surface.
 *
 * Both `/integrations` (the canonical management page) and `/onboarding` (the
 * first-time setup wizard) consume the same endpoints, so the response shapes
 * live here to keep the two surfaces in lock-step with the backend contract
 * defined in `runtime/src/lib/integration-routes.ts`.
 */

export type Provider = "openrouter" | "linear" | "resend" | "slack" | "github"
export type Status = "active" | "disabled" | "invalid"

export interface IntegrationSummary {
  provider: Provider
  status: Status
  meta: Record<string, string>
  lastTestedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface LinearTeam {
  id: string
  name: string
  key: string
}

export interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
}

export interface TestPreview {
  teams?: LinearTeam[]
  channels?: SlackChannel[]
}

export type TestResponse =
  | { valid: true; integration: IntegrationSummary }
  | { valid: true; preview: TestPreview }
  | {
      valid: false
      reason: "invalid_key" | "network" | "not_implemented"
      message?: string
    }
