import { createLazyFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import {
  KeyRound,
  Sparkles,
  Ticket,
  MessagesSquare,
  Code2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  FolderGit2,
  ChevronDown,
  Check,
} from "lucide-react"
import { apiFetch } from "@/lib/api"
import { useCurrentProjectId } from "@/components/project-selector"
import { ConfirmDialog } from "@/components/confirm-dialog"

export const Route = createLazyFileRoute("/integrations")({
  component: IntegrationsPage,
})

type Provider = "openrouter" | "linear" | "resend" | "slack" | "github"
type Status = "active" | "disabled" | "invalid"

interface IntegrationSummary {
  provider: Provider
  status: Status
  meta: Record<string, string>
  lastTestedAt: string | null
  createdAt: string
  updatedAt: string
}

interface TestPreview {
  teams?: Array<{ id: string; name: string; key: string }>
}

type TestResponse =
  | {
      valid: true
      integration: IntegrationSummary
    }
  | {
      valid: true
      preview: TestPreview
    }
  | {
      valid: false
      reason: "invalid_key" | "network" | "not_implemented"
      message?: string
    }

function IntegrationsPage() {
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
            Integrations are per-project. Choose one from the sidebar to
            configure its keys.
          </p>
        </div>
      </div>
    )
  }

  return <IntegrationsContent projectId={currentProjectId} />
}

function IntegrationsContent({ projectId }: { projectId: string }) {
  const { data: integrations, isLoading } = useQuery<IntegrationSummary[]>({
    queryKey: ["integrations", projectId],
    queryFn: () =>
      apiFetch<IntegrationSummary[]>(`/projects/${projectId}/integrations`),
  })

  const byProvider: Partial<Record<Provider, IntegrationSummary>> = {}
  for (const row of integrations ?? []) byProvider[row.provider] = row

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-heading font-semibold text-foreground">
              Integrations
            </h1>
            <p className="text-xs text-muted-foreground">
              Per-project API keys. Stored encrypted at rest.
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-8">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && (
          <>
            <DomainSection
              title="LLM"
              description="Language model providers for agents and embeddings."
            >
              <OpenRouterCard
                projectId={projectId}
                summary={byProvider.openrouter}
              />
            </DomainSection>

            <DomainSection
              title="Ticketing"
              description="Where triage creates tickets and checks evidence."
            >
              <LinearCard projectId={projectId} summary={byProvider.linear} />
            </DomainSection>

            <DomainSection
              title="Communication"
              description="Notifications to reporters and assignees."
            >
              <StubCard
                icon={<MessagesSquare className="h-5 w-5" />}
                title="Resend"
                description="Outbound email provider."
              />
              <StubCard
                icon={<MessagesSquare className="h-5 w-5" />}
                title="Slack"
                description="Bot token + channel for ticket notifications."
              />
            </DomainSection>

            <DomainSection
              title="Code"
              description="Evidence lookups for resolution review."
            >
              <StubCard
                icon={<Code2 className="h-5 w-5" />}
                title="GitHub"
                description="Personal access token (repo scope)."
              />
            </DomainSection>
          </>
        )}
      </div>
    </div>
  )
}

function DomainSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground/70 mt-0.5">{description}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  )
}

function StatusBadge({ status }: { status: Status | "not-configured" }) {
  if (status === "active") {
    return (
      <span className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Active
      </span>
    )
  }
  if (status === "invalid") {
    return (
      <span className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-500">
        <AlertCircle className="h-3.5 w-3.5" />
        Invalid
      </span>
    )
  }
  if (status === "disabled") {
    return (
      <span className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
        Disabled
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
      Not configured
    </span>
  )
}

function OpenRouterCard({
  projectId,
  summary,
}: {
  projectId: string
  summary: IntegrationSummary | undefined
}) {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState("")
  const [editing, setEditing] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const [testSuccess, setTestSuccess] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const testMutation = useMutation({
    mutationFn: async (key: string) => {
      const res = await apiFetch<TestResponse>(
        `/projects/${projectId}/integrations/openrouter/test`,
        {
          method: "POST",
          body: JSON.stringify({ apiKey: key }),
        },
      )
      return res
    },
    onSuccess: (res) => {
      if (res.valid) {
        setTestSuccess(true)
        setTestError(null)
        setApiKey("")
        setEditing(false)
        queryClient.invalidateQueries({ queryKey: ["integrations", projectId] })
        setTimeout(() => setTestSuccess(false), 2500)
      } else {
        setTestSuccess(false)
        setTestError(reasonToMessage(res))
      }
    },
    onError: (err: Error) => {
      setTestError(err.message)
      setTestSuccess(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectId}/integrations/openrouter`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", projectId] })
      setApiKey("")
      setEditing(false)
      setTestError(null)
      setDeleteOpen(false)
    },
  })

  const configured = !!summary
  const status: Status | "not-configured" = configured ? summary!.status : "not-configured"
  const showInput = editing || !configured

  return (
    <div className="rounded-2xl bg-card border border-border/50 p-5 shadow-neu-sm">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">OpenRouter</h3>
            <p className="text-xs text-muted-foreground">
              Key for all LLM agents and wiki embeddings.
            </p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {showInput ? (
        <div className="space-y-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              setTestError(null)
              setTestSuccess(false)
            }}
            placeholder="sk-or-..."
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
          />
          <div className="flex gap-2">
            <button
              onClick={() => testMutation.mutate(apiKey)}
              disabled={!apiKey || testMutation.isPending}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-neu-sm hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Test & Save
            </button>
            {configured && (
              <button
                onClick={() => {
                  setEditing(false)
                  setApiKey("")
                  setTestError(null)
                }}
                className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 rounded-xl border border-border bg-background/50 px-3 py-2 text-sm text-muted-foreground font-mono">
              ●●●●●●●●●●●●●●●●
            </span>
            <button
              onClick={() => setEditing(true)}
              className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
              Change
            </button>
            <button
              onClick={() => setDeleteOpen(true)}
              disabled={deleteMutation.isPending}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              title="Remove key"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {summary?.lastTestedAt && (
            <p className="text-xs text-muted-foreground">
              Tested {formatRelative(summary.lastTestedAt)}
            </p>
          )}
        </div>
      )}

      {testError && (
        <p className="mt-3 text-xs text-red-500 font-medium">{testError}</p>
      )}
      {testSuccess && (
        <p className="mt-3 text-xs text-emerald-500 font-medium">
          ✓ Key validated and saved.
        </p>
      )}

      <ConfirmDialog
        open={deleteOpen}
        variant="destructive"
        title="Remove OpenRouter key?"
        description="Agents on this project will fall back to the server-side environment key. Existing conversations are unaffected."
        confirmLabel="Remove key"
        cancelLabel="Keep"
        loading={deleteMutation.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  )
}

interface LinearTeam {
  id: string
  name: string
  key: string
}

function TeamPicker({
  teams,
  value,
  onChange,
}: {
  teams: LinearTeam[]
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape so keyboard users can dismiss without
  // selecting.
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKey)
    }
  }, [open])

  const selected = teams.find((t) => t.id === value)
  const label = selected ? `${selected.name} (${selected.key})` : "Select a team"

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors hover:bg-muted/20"
      >
        <span className={selected ? "" : "text-muted-foreground"}>{label}</span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-card shadow-neu-sm overflow-hidden">
          <div className="max-h-60 overflow-y-auto py-1">
            {teams.map((t) => {
              const isSelected = t.id === value
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    onChange(t.id)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    isSelected
                      ? "bg-primary/10 text-foreground"
                      : "text-foreground hover:bg-muted/30"
                  }`}
                >
                  <span className="flex-1">
                    {t.name}{" "}
                    <span className="text-muted-foreground">({t.key})</span>
                  </span>
                  {isSelected && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function LinearCard({
  projectId,
  summary,
}: {
  projectId: string
  summary: IntegrationSummary | undefined
}) {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState("")
  const [teams, setTeams] = useState<LinearTeam[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState("")
  const [editing, setEditing] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const testMutation = useMutation({
    mutationFn: async (key: string) => {
      const res = await apiFetch<TestResponse>(
        `/projects/${projectId}/integrations/linear/test`,
        { method: "POST", body: JSON.stringify({ apiKey: key }) },
      )
      return res
    },
    onSuccess: (res) => {
      if (res.valid && "preview" in res) {
        setTestError(null)
        setTeams(res.preview.teams ?? [])
        setSelectedTeamId(res.preview.teams?.[0]?.id ?? "")
      } else if (res.valid) {
        // Backend returned a persisted integration without preview — shouldn't
        // happen for Linear but handle gracefully.
        setTestError(null)
        queryClient.invalidateQueries({ queryKey: ["integrations", projectId] })
      } else {
        setTeams([])
        setSelectedTeamId("")
        setTestError(reasonToMessage(res))
      }
    },
    onError: (err: Error) => {
      setTestError(err.message)
    },
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const team = teams.find((t) => t.id === selectedTeamId)
      if (!team) throw new Error("Select a team before saving")
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
      setSaveSuccess(true)
      setApiKey("")
      setTeams([])
      setSelectedTeamId("")
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ["integrations", projectId] })
      setTimeout(() => setSaveSuccess(false), 2500)
    },
    onError: (err: Error) => {
      setTestError(err.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectId}/integrations/linear`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", projectId] })
      setApiKey("")
      setTeams([])
      setSelectedTeamId("")
      setEditing(false)
      setTestError(null)
      setDeleteOpen(false)
    },
  })

  const configured = !!summary
  const status: Status | "not-configured" = configured ? summary!.status : "not-configured"
  const showInput = editing || !configured

  return (
    <div className="rounded-2xl bg-card border border-border/50 p-5 shadow-neu-sm">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Ticket className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">Linear</h3>
            <p className="text-xs text-muted-foreground">
              Personal API token + team for ticket creation.
            </p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {showInput ? (
        <div className="space-y-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              setTestError(null)
              setTeams([])
              setSelectedTeamId("")
            }}
            placeholder="lin_api_..."
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
          />

          {teams.length > 0 && (
            <div className="space-y-1 pt-1">
              <label className="text-xs text-muted-foreground font-medium">
                Team
              </label>
              <TeamPicker
                teams={teams}
                value={selectedTeamId}
                onChange={setSelectedTeamId}
              />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            {teams.length === 0 ? (
              <button
                onClick={() => testMutation.mutate(apiKey)}
                disabled={!apiKey || testMutation.isPending}
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-neu-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {testMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Test
              </button>
            ) : (
              <button
                onClick={() => saveMutation.mutate()}
                disabled={!selectedTeamId || saveMutation.isPending}
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-neu-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Save
              </button>
            )}
            {configured && (
              <button
                onClick={() => {
                  setEditing(false)
                  setApiKey("")
                  setTeams([])
                  setSelectedTeamId("")
                  setTestError(null)
                }}
                className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 rounded-xl border border-border bg-background/50 px-3 py-2 text-sm text-muted-foreground font-mono">
              ●●●●●●●●●●●●●●●●
            </span>
            <button
              onClick={() => setEditing(true)}
              className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
              Change
            </button>
            <button
              onClick={() => setDeleteOpen(true)}
              disabled={deleteMutation.isPending}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              title="Remove key"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {summary?.meta.teamName && (
            <p className="text-xs text-muted-foreground">
              Team: <span className="text-foreground">{summary.meta.teamName}</span>
              {summary.meta.teamKey && (
                <span className="ml-1 text-muted-foreground/70">
                  ({summary.meta.teamKey})
                </span>
              )}
            </p>
          )}
          {summary?.lastTestedAt && (
            <p className="text-xs text-muted-foreground">
              Tested {formatRelative(summary.lastTestedAt)}
            </p>
          )}
        </div>
      )}

      {testError && (
        <p className="mt-3 text-xs text-red-500 font-medium">{testError}</p>
      )}
      {saveSuccess && (
        <p className="mt-3 text-xs text-emerald-500 font-medium">
          ✓ Linear connected.
        </p>
      )}

      <ConfirmDialog
        open={deleteOpen}
        variant="destructive"
        title="Remove Linear integration?"
        description="Triage will fall back to the server-side key. Existing tickets are unaffected."
        confirmLabel="Remove"
        cancelLabel="Keep"
        loading={deleteMutation.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  )
}

function StubCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="rounded-2xl bg-card/50 border border-dashed border-border/50 p-5 opacity-70">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/40 text-muted-foreground">
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <span className="rounded-lg bg-muted/40 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Coming soon
        </span>
      </div>
      <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
        Currently falls back to server-side environment variable.
      </div>
    </div>
  )
}

function reasonToMessage(res: Extract<TestResponse, { valid: false }>): string {
  if (res.reason === "invalid_key") return "Key rejected by OpenRouter (401)."
  if (res.reason === "network")
    return `Couldn't reach OpenRouter${res.message ? ` — ${res.message}` : ""}.`
  if (res.reason === "not_implemented")
    return "Test connection isn't implemented for this provider yet."
  return "Test failed."
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const min = Math.round(diff / 60_000)
  if (min < 1) return "just now"
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const d = Math.round(hr / 24)
  return `${d} d ago`
}
