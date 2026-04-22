import { createLazyFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import {
  KeyRound,
  Sparkles,
  Ticket,
  MessagesSquare,
  Mail,
  Code2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  FolderGit2,
} from "lucide-react"
import { apiFetch } from "@/lib/api"
import { useCurrentProjectId } from "@/components/project-selector"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Picker } from "@/components/picker"

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

interface LinearTeam {
  id: string
  name: string
  key: string
}
interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
}

interface TestPreview {
  teams?: LinearTeam[]
  channels?: SlackChannel[]
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
              <ResendCard projectId={projectId} summary={byProvider.resend} />
              <SlackCard projectId={projectId} summary={byProvider.slack} />
            </DomainSection>

            <DomainSection
              title="Code"
              description="Evidence lookups for resolution review."
            >
              <GitHubCard projectId={projectId} summary={byProvider.github} />
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
        setTestError(reasonToMessage(res, "OpenRouter"))
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
        setTestError(reasonToMessage(res, "Linear"))
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
              <Picker
                items={teams}
                value={selectedTeamId}
                getValue={(t) => t.id}
                getLabel={(t) => (
                  <>
                    {t.name}{" "}
                    <span className="text-muted-foreground">({t.key})</span>
                  </>
                )}
                onChange={setSelectedTeamId}
                placeholder="Select a team"
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

function SlackCard({
  projectId,
  summary,
}: {
  projectId: string
  summary: IntegrationSummary | undefined
}) {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState("")
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState("")
  const [manualChannelId, setManualChannelId] = useState("")
  // `tokenValidated` separates "token is good" from "enumeration succeeded".
  // A bot token with only chat:write authenticates fine but can't list channels
  // — we still let the user save by typing the channel ID manually.
  const [tokenValidated, setTokenValidated] = useState(false)
  const [editing, setEditing] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const testMutation = useMutation({
    mutationFn: async (key: string) =>
      apiFetch<TestResponse>(
        `/projects/${projectId}/integrations/slack/test`,
        { method: "POST", body: JSON.stringify({ apiKey: key }) },
      ),
    onSuccess: (res) => {
      if (res.valid && "preview" in res) {
        setTestError(null)
        setTokenValidated(true)
        setChannels(res.preview.channels ?? [])
        setSelectedChannelId(res.preview.channels?.[0]?.id ?? "")
      } else if (!res.valid) {
        setTokenValidated(false)
        setChannels([])
        setSelectedChannelId("")
        setTestError(reasonToMessage(res, "Slack"))
      }
    },
    onError: (err: Error) => setTestError(err.message),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const picked = channels.find((c) => c.id === selectedChannelId)
      const channelId = picked?.id ?? manualChannelId.trim()
      if (!channelId) throw new Error("Select or enter a channel before saving")
      const meta: Record<string, string> = { channelId }
      if (picked) meta.channelName = picked.name
      return apiFetch<IntegrationSummary>(
        `/projects/${projectId}/integrations/slack`,
        { method: "PUT", body: JSON.stringify({ apiKey, meta }) },
      )
    },
    onSuccess: () => {
      setSaveSuccess(true)
      setApiKey("")
      setChannels([])
      setSelectedChannelId("")
      setManualChannelId("")
      setTokenValidated(false)
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ["integrations", projectId] })
      setTimeout(() => setSaveSuccess(false), 2500)
    },
    onError: (err: Error) => setTestError(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectId}/integrations/slack`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", projectId] })
      setApiKey("")
      setChannels([])
      setSelectedChannelId("")
      setManualChannelId("")
      setTokenValidated(false)
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
            <MessagesSquare className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">Slack</h3>
            <p className="text-xs text-muted-foreground">
              Bot token + channel for triage notifications.
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
              setTokenValidated(false)
              setChannels([])
              setSelectedChannelId("")
              setManualChannelId("")
            }}
            placeholder="xoxb-..."
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
          />

          {tokenValidated && channels.length > 0 && (
            <div className="space-y-1 pt-1">
              <label className="text-xs text-muted-foreground font-medium">
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
                placeholder="Select a channel"
              />
            </div>
          )}

          {tokenValidated && channels.length === 0 && (
            <div className="space-y-1 pt-1">
              <label className="text-xs text-muted-foreground font-medium">
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
                Token authenticated but lacks <code>channels:read</code>/<code>groups:read</code>.
                Paste the channel ID manually (right-click channel → Copy link).
              </p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            {!tokenValidated ? (
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
                disabled={
                  (channels.length > 0 ? !selectedChannelId : !manualChannelId.trim()) ||
                  saveMutation.isPending
                }
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
                  setChannels([])
                  setSelectedChannelId("")
                  setManualChannelId("")
                  setTokenValidated(false)
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
          {(summary?.meta.channelName || summary?.meta.channelId) && (
            <p className="text-xs text-muted-foreground">
              Channel:{" "}
              <span className="text-foreground">
                {summary.meta.channelName
                  ? `#${summary.meta.channelName}`
                  : summary.meta.channelId}
              </span>
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
          ✓ Slack connected.
        </p>
      )}

      <ConfirmDialog
        open={deleteOpen}
        variant="destructive"
        title="Remove Slack integration?"
        description="Triage will fall back to the server-side bot token. Existing messages are unaffected."
        confirmLabel="Remove"
        cancelLabel="Keep"
        loading={deleteMutation.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  )
}

function ResendCard({
  projectId,
  summary,
}: {
  projectId: string
  summary: IntegrationSummary | undefined
}) {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState("")
  const [fromEmail, setFromEmail] = useState("")
  const [editing, setEditing] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const [testSuccess, setTestSuccess] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)

  const testMutation = useMutation({
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
        setTestSuccess(true)
        setTestError(null)
        setApiKey("")
        setFromEmail("")
        setEditing(false)
        queryClient.invalidateQueries({ queryKey: ["integrations", projectId] })
        setTimeout(() => setTestSuccess(false), 2500)
      } else {
        setTestSuccess(false)
        setTestError(reasonToMessage(res, "Resend"))
      }
    },
    onError: (err: Error) => {
      setTestError(err.message)
      setTestSuccess(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectId}/integrations/resend`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", projectId] })
      setApiKey("")
      setFromEmail("")
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
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">Resend</h3>
            <p className="text-xs text-muted-foreground">
              API key + verified from address for outbound email.
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
            }}
            placeholder="re_..."
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
          />
          <input
            type="email"
            value={fromEmail}
            onChange={(e) => {
              setFromEmail(e.target.value)
              setTestError(null)
            }}
            placeholder="triage@yourdomain.com"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <p className="text-[11px] text-muted-foreground/80">
            Must be an address on a domain verified in your Resend account.
          </p>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => testMutation.mutate()}
              disabled={!apiKey || !isValidEmail || testMutation.isPending}
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
                  setFromEmail("")
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
          {summary?.meta.fromEmail && (
            <p className="text-xs text-muted-foreground">
              From:{" "}
              <span className="text-foreground">{summary.meta.fromEmail}</span>
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
      {testSuccess && (
        <p className="mt-3 text-xs text-emerald-500 font-medium">
          ✓ Resend connected.
        </p>
      )}

      <ConfirmDialog
        open={deleteOpen}
        variant="destructive"
        title="Remove Resend integration?"
        description="Triage will fall back to the server-side key. Queued emails already sent are unaffected."
        confirmLabel="Remove"
        cancelLabel="Keep"
        loading={deleteMutation.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  )
}

interface ProjectForGithub {
  id: string
  name: string
  repositoryUrl: string
  status: string
}

/**
 * Simple github.com URL parser — mirrors the backend helper so the card can
 * pre-empt a "project repo isn't on GitHub" error and render a friendlier
 * disabled state up-front. Backend still enforces authoritatively.
 */
function parseGithubRepo(url: string): { owner: string; repo: string; full: string } | null {
  if (!url) return null
  const m =
    /^(?:https?|ssh):\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim()) ??
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim())
  if (!m) return null
  return { owner: m[1], repo: m[2], full: `${m[1]}/${m[2]}` }
}

function GitHubCard({
  projectId,
  summary,
}: {
  projectId: string
  summary: IntegrationSummary | undefined
}) {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState("")
  const [editing, setEditing] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [retrySuccess, setRetrySuccess] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // The card needs the project's repo URL to render "Verify access to X".
  // `/projects/:id` is a cheap ownership-checked read.
  const { data: project } = useQuery<ProjectForGithub>({
    queryKey: ["project", projectId],
    queryFn: () => apiFetch<ProjectForGithub>(`/projects/${projectId}`),
  })

  const parsed = project ? parseGithubRepo(project.repositoryUrl) : null
  const repoFullName = summary?.meta.repoFullName ?? parsed?.full ?? null

  const verifyMutation = useMutation({
    mutationFn: async () =>
      apiFetch<IntegrationSummary>(
        `/projects/${projectId}/integrations/github`,
        { method: "PUT", body: JSON.stringify({ apiKey }) },
      ),
    onSuccess: () => {
      setSaveSuccess(true)
      setApiKey("")
      setEditing(false)
      setVerifyError(null)
      queryClient.invalidateQueries({ queryKey: ["integrations", projectId] })
      // Project status may have flipped needs_auth → pending; refresh so the
      // UI picks that up without a tab switch.
      queryClient.invalidateQueries({ queryKey: ["projects"] })
      queryClient.invalidateQueries({ queryKey: ["project", projectId] })
      setTimeout(() => setSaveSuccess(false), 2500)
    },
    onError: (err: Error) => setVerifyError(err.message),
  })

  const retryMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectId}/wiki/generate`, { method: "POST" }),
    onSuccess: () => {
      setRetrySuccess(true)
      queryClient.invalidateQueries({ queryKey: ["projects"] })
      queryClient.invalidateQueries({ queryKey: ["project", projectId] })
      setTimeout(() => setRetrySuccess(false), 2500)
    },
    onError: (err: Error) => setVerifyError(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectId}/integrations/github`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", projectId] })
      setApiKey("")
      setEditing(false)
      setVerifyError(null)
      setDeleteOpen(false)
    },
  })

  const configured = !!summary
  const status: Status | "not-configured" = configured
    ? summary!.status
    : "not-configured"
  const showInput = editing || !configured

  // Project repo isn't on GitHub — don't even offer the PAT input. Mirrors
  // the backend PROJECT_REPO_NOT_GITHUB rejection but avoids a round-trip.
  const projectIsNonGithub = project !== undefined && parsed === null && Boolean(project.repositoryUrl)

  return (
    <div className="rounded-2xl bg-card border border-border/50 p-5 shadow-neu-sm">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Code2 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">GitHub</h3>
            <p className="text-xs text-muted-foreground">
              Personal access token (repo scope) for private-repo wiki + evidence lookups.
            </p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {projectIsNonGithub ? (
        <p className="text-xs text-muted-foreground">
          This project's repository isn't hosted on GitHub, so no token is needed.
        </p>
      ) : showInput ? (
        <div className="space-y-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              setVerifyError(null)
            }}
            placeholder="ghp_... or github_pat_..."
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
          />

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => verifyMutation.mutate()}
              disabled={!apiKey || verifyMutation.isPending || !repoFullName}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-neu-sm hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {verifyMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {repoFullName
                ? `Verify access to ${repoFullName}`
                : "Verify access"}
            </button>
            {configured && (
              <button
                onClick={() => {
                  setEditing(false)
                  setApiKey("")
                  setVerifyError(null)
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
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
              className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-50"
              title="Re-run wiki generation with the stored token"
            >
              {retryMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Retry wiki"
              )}
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
          {repoFullName && (
            <p className="text-xs text-muted-foreground">
              Repo:{" "}
              <span className="text-foreground">{repoFullName}</span>
            </p>
          )}
          {summary?.lastTestedAt && (
            <p className="text-xs text-muted-foreground">
              Tested {formatRelative(summary.lastTestedAt)}
            </p>
          )}
        </div>
      )}

      {verifyError && (
        <p className="mt-3 text-xs text-red-500 font-medium">{verifyError}</p>
      )}
      {saveSuccess && (
        <p className="mt-3 text-xs text-emerald-500 font-medium">
          ✓ GitHub connected.
        </p>
      )}
      {retrySuccess && (
        <p className="mt-3 text-xs text-emerald-500 font-medium">
          ✓ Wiki generation started.
        </p>
      )}

      <ConfirmDialog
        open={deleteOpen}
        variant="destructive"
        title="Remove GitHub integration?"
        description="Triage will fall back to the server-side token. Nothing is deleted from GitHub."
        confirmLabel="Remove"
        cancelLabel="Keep"
        loading={deleteMutation.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  )
}

function reasonToMessage(
  res: Extract<TestResponse, { valid: false }>,
  providerName: string,
): string {
  if (res.reason === "invalid_key") return `Key rejected by ${providerName} (401).`
  if (res.reason === "network")
    return `Couldn't reach ${providerName}${res.message ? ` — ${res.message}` : ""}.`
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
