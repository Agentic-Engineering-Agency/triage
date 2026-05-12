/**
 * Onboarding wizard — sequential setup for the 5 per-project integrations.
 *
 * Lives at /onboarding. Reads from the same `/integrations` endpoint as the
 * canonical management page; each step calls the same `/test` + PUT contract.
 * The wizard is purely additive: skipping a step never changes the backing
 * row, and users can always come back via /integrations to edit.
 *
 * Step order (priority): openrouter → linear → github → slack → resend.
 *   - openrouter, linear, github are flagged "required" so the global header
 *     CTA shows the count of remaining required steps.
 *   - slack, resend are optional and the "Skip" button reads accordingly.
 *   - github is auto-skipped when the project repo isn't on github.com (same
 *     check the GitHubCard pre-emptively renders on /integrations).
 */
import { createLazyFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  SkipForward,
  Sparkles,
  FolderGit2,
} from "lucide-react"
import { apiFetch } from "@/lib/api"
import { useCurrentProjectId } from "@/components/project-selector"
import { Picker } from "@/components/picker"
import { BrandIcon } from "@/components/brand-icon"
import {
  type IntegrationSummary,
  type LinearTeam,
  type Provider,
  type SlackChannel,
  type TestResponse,
} from "@/components/integrations/types"
import { reasonToMessage } from "@/components/integrations/helpers"

export const Route = createLazyFileRoute("/onboarding")({
  component: OnboardingPage,
})

// ─── Step model ─────────────────────────────────────────────────────────────

interface StepDef {
  provider: Provider
  title: string
  blurb: string
  required: boolean
}

const STEPS: ReadonlyArray<StepDef> = [
  {
    provider: "openrouter",
    title: "OpenRouter",
    blurb: "Key for all LLM agents and wiki embeddings.",
    required: true,
  },
  {
    provider: "linear",
    title: "Linear",
    blurb: "Personal API token + team for ticket creation.",
    required: true,
  },
  {
    provider: "github",
    title: "GitHub",
    blurb: "Personal access token (repo scope) for private-repo wiki + evidence lookups.",
    required: true,
  },
  {
    provider: "slack",
    title: "Slack",
    blurb: "Bot token + channel for triage notifications.",
    required: false,
  },
  {
    provider: "resend",
    title: "Resend",
    blurb: "API key + verified from address for outbound email.",
    required: false,
  },
]

interface ProjectMeta {
  id: string
  name: string
  repositoryUrl: string
  status: string
}

function isGithubUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /(^|@|\/)github\.com[/:]/i.test(url.trim())
}

// ─── Wizard shell ───────────────────────────────────────────────────────────

function OnboardingPage() {
  const [currentProjectId] = useCurrentProjectId()
  if (!currentProjectId) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FolderGit2 className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-heading font-semibold mb-2">
            Select a project
          </h2>
          <p className="text-sm text-muted-foreground">
            The setup wizard is per-project. Pick one from the sidebar to begin.
          </p>
        </div>
      </div>
    )
  }
  return <Wizard projectId={currentProjectId} />
}

function Wizard({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const { data: integrations, isLoading: integrationsLoading } = useQuery<
    IntegrationSummary[]
  >({
    queryKey: ["integrations", projectId],
    queryFn: () =>
      apiFetch<IntegrationSummary[]>(`/projects/${projectId}/integrations`),
  })
  const { data: project, isLoading: projectLoading } = useQuery<ProjectMeta>({
    queryKey: ["project", projectId],
    queryFn: () => apiFetch<ProjectMeta>(`/projects/${projectId}`),
  })

  const byProvider = useMemo<Partial<Record<Provider, IntegrationSummary>>>(
    () => {
      const acc: Partial<Record<Provider, IntegrationSummary>> = {}
      for (const row of integrations ?? []) acc[row.provider] = row
      return acc
    },
    [integrations],
  )

  // Filter the canonical step order down to the steps that apply to this
  // project. Today the only conditional skip is GitHub for non-github repos.
  const applicableSteps = useMemo(() => {
    if (!project) return STEPS
    return STEPS.filter((s) => {
      if (s.provider === "github") return isGithubUrl(project.repositoryUrl)
      return true
    })
  }, [project])

  const [stepIndex, setStepIndex] = useState(0)
  const safeIndex = Math.min(stepIndex, applicableSteps.length - 1)
  const currentStep = applicableSteps[safeIndex]

  const remainingRequired = applicableSteps.filter(
    (s) => s.required && byProvider[s.provider]?.status !== "active",
  ).length

  const isLoading = integrationsLoading || projectLoading

  function advance() {
    if (safeIndex < applicableSteps.length - 1) {
      setStepIndex(safeIndex + 1)
    } else {
      // Last step — flow ends. Send the user to the chat for the project.
      navigate({ to: "/chat" })
    }
  }
  function goBack() {
    if (safeIndex > 0) setStepIndex(safeIndex - 1)
  }

  if (isLoading || !currentStep) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const currentSummary = byProvider[currentStep.provider]
  const isLastStep = safeIndex === applicableSteps.length - 1

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-heading font-semibold text-foreground">
              Set up {project?.name ?? "your project"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {remainingRequired === 0
                ? "All required integrations are configured."
                : `${remainingRequired} required integration${remainingRequired === 1 ? "" : "s"} remaining.`}
            </p>
          </div>
        </div>
        <Link
          to="/chat"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Configure later →
        </Link>
      </div>

      {/* Progress dots */}
      <ProgressStrip
        steps={applicableSteps}
        currentIndex={safeIndex}
        byProvider={byProvider}
        onJump={setStepIndex}
      />

      {/* Step body */}
      <div className="flex-1 overflow-auto px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <StepHeader step={currentStep} />
          <StepBody
            projectId={projectId}
            project={project}
            step={currentStep}
            summary={currentSummary}
          />
        </div>
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-border/50">
        <button
          onClick={goBack}
          disabled={safeIndex === 0}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex items-center gap-2">
          {currentSummary?.status === "active" ? (
            <button
              onClick={advance}
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-neu-sm hover:opacity-90 transition-opacity"
            >
              {isLastStep ? "Finish" : "Continue"}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={advance}
              className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              title={
                currentStep.required
                  ? "Skip — you can configure this from /integrations later"
                  : "Skip — optional integration"
              }
            >
              <SkipForward className="h-4 w-4" />
              {isLastStep ? "Finish without saving" : "Skip"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ProgressStrip({
  steps,
  currentIndex,
  byProvider,
  onJump,
}: {
  steps: ReadonlyArray<StepDef>
  currentIndex: number
  byProvider: Partial<Record<Provider, IntegrationSummary>>
  onJump: (i: number) => void
}) {
  return (
    <div className="border-b border-border/50 bg-muted/20 px-6 py-3">
      <div className="mx-auto flex max-w-2xl items-center gap-2">
        {steps.map((step, i) => {
          const summary = byProvider[step.provider]
          const isActive = summary?.status === "active"
          const isCurrent = i === currentIndex
          return (
            <button
              key={step.provider}
              onClick={() => onJump(i)}
              className={`flex-1 group relative flex flex-col gap-1 rounded-lg px-2 py-1 text-left transition-colors ${
                isCurrent ? "bg-card shadow-neu-sm" : "hover:bg-muted/30"
              }`}
              title={step.title}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium transition-colors ${
                    isActive
                      ? "bg-emerald-500/15 text-emerald-500"
                      : isCurrent
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isActive ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={`text-xs font-medium truncate ${
                    isCurrent ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {step.title}
                </span>
              </div>
              {!step.required && (
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 pl-7">
                  Optional
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StepHeader({ step }: { step: StepDef }) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <BrandIcon name={step.provider} className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-xl font-heading font-semibold text-foreground">
          {step.title}
          {!step.required && (
            <span className="ml-2 text-xs font-normal text-muted-foreground/70 uppercase tracking-wider">
              Optional
            </span>
          )}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">{step.blurb}</p>
      </div>
    </div>
  )
}

function StepBody({
  projectId,
  project,
  step,
  summary,
}: {
  projectId: string
  project: ProjectMeta | undefined
  step: StepDef
  summary: IntegrationSummary | undefined
}) {
  // Already configured → render the canonical confirmation panel. The user
  // can still re-run setup by clicking "Reconfigure" which clears the row.
  if (summary?.status === "active") {
    return <ConfiguredPanel projectId={projectId} provider={step.provider} summary={summary} />
  }

  switch (step.provider) {
    case "openrouter":
      return <OpenRouterStep projectId={projectId} />
    case "linear":
      return <LinearStep projectId={projectId} />
    case "github":
      return <GithubStep projectId={projectId} project={project} />
    case "slack":
      return <SlackStep projectId={projectId} />
    case "resend":
      return <ResendStep projectId={projectId} />
  }
}

// ─── Configured state (shared) ──────────────────────────────────────────────

function ConfiguredPanel({
  projectId,
  provider,
  summary,
}: {
  projectId: string
  provider: Provider
  summary: IntegrationSummary
}) {
  const queryClient = useQueryClient()
  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectId}/integrations/${provider}`, {
        method: "DELETE",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["integrations", projectId] }),
  })

  const metaPairs = Object.entries(summary.meta).filter(
    ([, v]) => v != null && v !== "",
  )

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6">
      <div className="flex items-center gap-3 mb-4">
        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        <p className="text-sm font-medium text-foreground">
          Already configured for this project.
        </p>
      </div>
      {metaPairs.length > 0 && (
        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground mb-4">
          {metaPairs.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-medium">{k}</dt>
              <dd className="font-mono break-all">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <button
        onClick={() => deleteMutation.mutate()}
        disabled={deleteMutation.isPending}
        className="text-xs text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
      >
        {deleteMutation.isPending
          ? "Removing…"
          : "Reconfigure (removes current key)"}
      </button>
    </div>
  )
}

// ─── OpenRouter step ────────────────────────────────────────────────────────

function OpenRouterStep({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState("")
  const [error, setError] = useState<string | null>(null)

  const m = useMutation({
    mutationFn: async () =>
      apiFetch<TestResponse>(
        `/projects/${projectId}/integrations/openrouter/test`,
        { method: "POST", body: JSON.stringify({ apiKey }) },
      ),
    onSuccess: (res) => {
      if (res.valid) {
        setError(null)
        setApiKey("")
        queryClient.invalidateQueries({
          queryKey: ["integrations", projectId],
        })
      } else {
        setError(reasonToMessage(res, "OpenRouter"))
      }
    },
    onError: (err: Error) => setError(err.message),
  })

  return (
    <StepCard>
      <PasswordField
        value={apiKey}
        onChange={(v) => {
          setApiKey(v)
          setError(null)
        }}
        placeholder="sk-or-..."
      />
      <PrimaryButton
        onClick={() => m.mutate()}
        disabled={!apiKey || m.isPending}
        loading={m.isPending}
      >
        Test &amp; Save
      </PrimaryButton>
      <ErrorLine error={error} />
    </StepCard>
  )
}

// ─── Linear step ────────────────────────────────────────────────────────────

function LinearStep({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState("")
  const [teams, setTeams] = useState<LinearTeam[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState("")
  const [error, setError] = useState<string | null>(null)

  const test = useMutation({
    mutationFn: async () =>
      apiFetch<TestResponse>(
        `/projects/${projectId}/integrations/linear/test`,
        { method: "POST", body: JSON.stringify({ apiKey }) },
      ),
    onSuccess: (res) => {
      if (res.valid && "preview" in res) {
        setError(null)
        setTeams(res.preview.teams ?? [])
        setSelectedTeamId(res.preview.teams?.[0]?.id ?? "")
      } else if (!res.valid) {
        setTeams([])
        setSelectedTeamId("")
        setError(reasonToMessage(res, "Linear"))
      }
    },
    onError: (err: Error) => setError(err.message),
  })

  const save = useMutation({
    mutationFn: async () => {
      const team = teams.find((t) => t.id === selectedTeamId)
      if (!team) throw new Error("Pick a team before saving")
      return apiFetch<IntegrationSummary>(
        `/projects/${projectId}/integrations/linear`,
        {
          method: "PUT",
          body: JSON.stringify({
            apiKey,
            meta: { teamId: team.id, teamName: team.name, teamKey: team.key },
          }),
        },
      )
    },
    onSuccess: () => {
      setError(null)
      setApiKey("")
      setTeams([])
      setSelectedTeamId("")
      queryClient.invalidateQueries({ queryKey: ["integrations", projectId] })
    },
    onError: (err: Error) => setError(err.message),
  })

  return (
    <StepCard>
      <PasswordField
        value={apiKey}
        onChange={(v) => {
          setApiKey(v)
          setError(null)
          setTeams([])
          setSelectedTeamId("")
        }}
        placeholder="lin_api_..."
      />
      {teams.length > 0 && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Team
          </label>
          <Picker
            items={teams}
            value={selectedTeamId}
            getValue={(t) => t.id}
            getLabel={(t) => `${t.name} (${t.key})`}
            onChange={setSelectedTeamId}
            placeholder="Pick a team"
          />
        </div>
      )}
      {teams.length === 0 ? (
        <PrimaryButton
          onClick={() => test.mutate()}
          disabled={!apiKey || test.isPending}
          loading={test.isPending}
        >
          Test
        </PrimaryButton>
      ) : (
        <PrimaryButton
          onClick={() => save.mutate()}
          disabled={!selectedTeamId || save.isPending}
          loading={save.isPending}
        >
          Save team
        </PrimaryButton>
      )}
      <ErrorLine error={error} />
    </StepCard>
  )
}

// ─── GitHub step ────────────────────────────────────────────────────────────

function GithubStep({
  projectId,
  project,
}: {
  projectId: string
  project: ProjectMeta | undefined
}) {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState("")
  const [error, setError] = useState<string | null>(null)

  const verify = useMutation({
    mutationFn: async () =>
      apiFetch<IntegrationSummary>(
        `/projects/${projectId}/integrations/github`,
        { method: "PUT", body: JSON.stringify({ apiKey }) },
      ),
    onSuccess: () => {
      setError(null)
      setApiKey("")
      queryClient.invalidateQueries({ queryKey: ["integrations", projectId] })
      queryClient.invalidateQueries({ queryKey: ["project", projectId] })
      queryClient.invalidateQueries({ queryKey: ["projects"] })
    },
    onError: (err: Error) => setError(err.message),
  })

  const repoUrl = project?.repositoryUrl ?? ""

  return (
    <StepCard>
      <p className="text-xs text-muted-foreground/80">
        The token is verified against{" "}
        <code className="font-mono text-foreground">{repoUrl}</code> directly.
        Use a fine-grained PAT scoped to that repo (Contents: Read).
      </p>
      <PasswordField
        value={apiKey}
        onChange={(v) => {
          setApiKey(v)
          setError(null)
        }}
        placeholder="ghp_... or github_pat_..."
      />
      <PrimaryButton
        onClick={() => verify.mutate()}
        disabled={!apiKey || verify.isPending}
        loading={verify.isPending}
      >
        Verify &amp; Save
      </PrimaryButton>
      <ErrorLine error={error} />
    </StepCard>
  )
}

// ─── Slack step ─────────────────────────────────────────────────────────────

function SlackStep({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState("")
  const [tokenValidated, setTokenValidated] = useState(false)
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState("")
  const [manualChannelId, setManualChannelId] = useState("")
  const [error, setError] = useState<string | null>(null)

  const test = useMutation({
    mutationFn: async () =>
      apiFetch<TestResponse>(
        `/projects/${projectId}/integrations/slack/test`,
        { method: "POST", body: JSON.stringify({ apiKey }) },
      ),
    onSuccess: (res) => {
      if (res.valid && "preview" in res) {
        setError(null)
        setTokenValidated(true)
        setChannels(res.preview.channels ?? [])
        setSelectedChannelId(res.preview.channels?.[0]?.id ?? "")
      } else if (!res.valid) {
        setTokenValidated(false)
        setChannels([])
        setSelectedChannelId("")
        setError(reasonToMessage(res, "Slack"))
      }
    },
    onError: (err: Error) => setError(err.message),
  })

  const save = useMutation({
    mutationFn: async () => {
      const picked = channels.find((c) => c.id === selectedChannelId)
      const channelId = picked?.id ?? manualChannelId.trim()
      if (!channelId) throw new Error("Pick or enter a channel before saving")
      const meta: Record<string, string> = { channelId }
      if (picked) meta.channelName = picked.name
      return apiFetch<IntegrationSummary>(
        `/projects/${projectId}/integrations/slack`,
        { method: "PUT", body: JSON.stringify({ apiKey, meta }) },
      )
    },
    onSuccess: () => {
      setError(null)
      setApiKey("")
      setChannels([])
      setSelectedChannelId("")
      setManualChannelId("")
      setTokenValidated(false)
      queryClient.invalidateQueries({ queryKey: ["integrations", projectId] })
    },
    onError: (err: Error) => setError(err.message),
  })

  return (
    <StepCard>
      <PasswordField
        value={apiKey}
        onChange={(v) => {
          setApiKey(v)
          setError(null)
          setTokenValidated(false)
          setChannels([])
          setSelectedChannelId("")
          setManualChannelId("")
        }}
        placeholder="xoxb-..."
      />

      {tokenValidated && channels.length > 0 && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Channel
          </label>
          <Picker
            items={channels}
            value={selectedChannelId}
            getValue={(c) => c.id}
            getLabel={(c) => (
              <>
                {c.isPrivate ? "🔒 " : "#"}
                {c.name}
              </>
            )}
            onChange={setSelectedChannelId}
            placeholder="Pick a channel"
          />
        </div>
      )}

      {tokenValidated && channels.length === 0 && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Channel ID
          </label>
          <input
            type="text"
            value={manualChannelId}
            onChange={(e) => setManualChannelId(e.target.value)}
            placeholder="C01234ABCDE"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
          />
          <p className="text-[11px] text-muted-foreground/80">
            Token authenticated but lacks <code>channels:read</code>/
            <code>groups:read</code>. Paste the channel ID manually
            (right-click channel → Copy link).
          </p>
        </div>
      )}

      {!tokenValidated ? (
        <PrimaryButton
          onClick={() => test.mutate()}
          disabled={!apiKey || test.isPending}
          loading={test.isPending}
        >
          Test
        </PrimaryButton>
      ) : (
        <PrimaryButton
          onClick={() => save.mutate()}
          disabled={
            (channels.length > 0 ? !selectedChannelId : !manualChannelId.trim()) ||
            save.isPending
          }
          loading={save.isPending}
        >
          Save channel
        </PrimaryButton>
      )}
      <ErrorLine error={error} />
    </StepCard>
  )
}

// ─── Resend step ────────────────────────────────────────────────────────────

function ResendStep({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState("")
  const [fromEmail, setFromEmail] = useState("")
  const [error, setError] = useState<string | null>(null)

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)

  const m = useMutation({
    mutationFn: async () =>
      apiFetch<TestResponse>(
        `/projects/${projectId}/integrations/resend/test`,
        {
          method: "POST",
          body: JSON.stringify({ apiKey, meta: { fromEmail } }),
        },
      ),
    onSuccess: (res) => {
      if (res.valid) {
        setError(null)
        setApiKey("")
        setFromEmail("")
        queryClient.invalidateQueries({
          queryKey: ["integrations", projectId],
        })
      } else {
        setError(reasonToMessage(res, "Resend"))
      }
    },
    onError: (err: Error) => setError(err.message),
  })

  return (
    <StepCard>
      <PasswordField
        value={apiKey}
        onChange={(v) => {
          setApiKey(v)
          setError(null)
        }}
        placeholder="re_..."
      />
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          From address
        </label>
        <input
          type="email"
          value={fromEmail}
          onChange={(e) => {
            setFromEmail(e.target.value)
            setError(null)
          }}
          placeholder="triage@yourdomain.com"
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <p className="text-[11px] text-muted-foreground/80">
          Must be on a domain verified in your Resend account.
        </p>
      </div>
      <PrimaryButton
        onClick={() => m.mutate()}
        disabled={!apiKey || !isValidEmail || m.isPending}
        loading={m.isPending}
      >
        Test &amp; Save
      </PrimaryButton>
      <ErrorLine error={error} />
    </StepCard>
  )
}

// ─── Shared form primitives ─────────────────────────────────────────────────

function StepCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-neu-sm space-y-4">
      {children}
    </div>
  )
}

function PasswordField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <input
      type="password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
    />
  )
}

function PrimaryButton({
  onClick,
  disabled,
  loading,
  children,
}: {
  onClick: () => void
  disabled: boolean
  loading: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-neu-sm hover:opacity-90 transition-opacity disabled:opacity-50"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <CheckCircle2 className="h-4 w-4" />
      )}
      {children}
    </button>
  )
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p className="flex items-center gap-2 text-xs text-red-500 font-medium">
      <AlertCircle className="h-3.5 w-3.5" />
      {error}
    </p>
  )
}
