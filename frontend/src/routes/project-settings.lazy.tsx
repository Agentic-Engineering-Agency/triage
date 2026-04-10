import { createLazyFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { CheckCircle2, XCircle, AlertCircle, FolderGit2 } from 'lucide-react'
import { useCurrentProjectId } from '@/components/project-selector'

export const Route = createLazyFileRoute('/project-settings')({
  component: ProjectSettingsPage,
})

interface IntegrationConfig {
  linear: {
    configured: boolean
    teamId: string | null
    webhookId: string | null
    webhookUrl: string | null
  }
  github: {
    configured: boolean
    owner: string | null
    repo: string | null
  }
  slack: {
    configured: boolean
    channelId: string | null
    webhookUrl: string | null
  }
}

async function apiFetch(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error?.message || `Request failed: ${response.status}`)
  }

  return response.json()
}

function ProjectSettingsPage() {
  const projectId = useCurrentProjectId()

  if (!projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <FolderGit2 className="h-12 w-12 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          Select a project to configure integrations
        </p>
      </div>
    )
  }

  return <SettingsContent projectId={projectId} />
}

function SettingsContent({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()

  // Fetch integration config
  const { data: integrations, isLoading } = useQuery<IntegrationConfig>({
    queryKey: ['project-integrations', projectId],
    queryFn: () =>
      apiFetch(`/api/projects/${projectId}/settings/integrations`).then(
        (res) => res.data,
      ),
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  const invalidateIntegrations = () => {
    queryClient.invalidateQueries({
      queryKey: ['project-integrations', projectId],
    })
  }

  return (
    <div className="flex flex-col overflow-y-auto">
      <div className="px-6 py-5 border-b border-border">
        <h1 className="text-2xl font-bold">Integration Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure integrations for project: <span className="font-mono">{projectId}</span>
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {integrations && (
          <>
            <LinearSection
              projectId={projectId}
              config={integrations.linear}
              onSuccess={invalidateIntegrations}
            />
            <GithubSection
              projectId={projectId}
              config={integrations.github}
              onSuccess={invalidateIntegrations}
            />
            <SlackSection
              projectId={projectId}
              config={integrations.slack}
              onSuccess={invalidateIntegrations}
            />
          </>
        )}
      </div>
    </div>
  )
}

function LinearSection({
  projectId,
  config,
  onSuccess,
}: {
  projectId: string
  config: IntegrationConfig['linear']
  onSuccess: () => void
}) {
  const [token, setToken] = useState('')
  const [teamId, setTeamId] = useState('')
  const [webhookUrl, setWebhookUrl] = useState(
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/webhooks/linear`
      : '',
  )
  const [testResult, setTestResult] = useState<{
    type: 'success' | 'error'
    message: string
    user?: { id: string; name: string; email: string }
  } | null>(null)
  const [webhookResult, setWebhookResult] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  const testTokenMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/projects/${projectId}/settings/linear/test`, {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    onSuccess: (res) => {
      setTestResult({
        type: 'success',
        message: res.data.message,
        user: res.data.user,
      })
      setToken('')
      onSuccess()
    },
    onError: (error) => {
      setTestResult({
        type: 'error',
        message: error.message,
      })
    },
  })

  const registerWebhookMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/projects/${projectId}/settings/linear/webhook`, {
        method: 'POST',
        body: JSON.stringify({
          url: webhookUrl,
          teamId: teamId || config.teamId,
        }),
      }),
    onSuccess: (res) => {
      setWebhookResult({
        type: 'success',
        message: res.data.message,
      })
      setWebhookUrl(
        typeof window !== 'undefined'
          ? `${window.location.origin}/api/webhooks/linear`
          : '',
      )
      setTeamId('')
      onSuccess()
    },
    onError: (error) => {
      setWebhookResult({
        type: 'error',
        message: error.message,
      })
    },
  })

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold uppercase text-muted-foreground">
          Linear Integration
        </h2>
        {config.configured ? (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Configured
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <XCircle className="h-4 w-4" />
            Not configured
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            API Token
          </label>
          <input
            type="password"
            placeholder={
              config.configured ? '●●●●●●●●●●●● (update to change)' : 'Paste your Linear API token'
            }
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <button
          onClick={() => testTokenMutation.mutate()}
          disabled={!token || testTokenMutation.isPending}
          className="w-full px-3 py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {testTokenMutation.isPending ? 'Testing...' : 'Test & Save'}
        </button>

        {testResult && (
          <div
            className={`text-xs p-2 rounded ${
              testResult.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-red-500/10 text-red-600 dark:text-red-400'
            }`}
          >
            {testResult.type === 'success' ? '✓ ' : '✗ '}
            {testResult.message}
            {testResult.user && (
              <div className="mt-1">
                Connected as {testResult.user.name} ({testResult.user.email})
              </div>
            )}
          </div>
        )}

        {config.configured && (
          <div className="border-t border-border pt-3 mt-3">
            <label className="text-xs font-medium text-muted-foreground">
              Webhook URL
            </label>
            <input
              type="text"
              placeholder="https://your-app.com/api/webhooks/linear"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />

            <label className="text-xs font-medium text-muted-foreground block mt-2">
              Team ID (optional)
            </label>
            <input
              type="text"
              placeholder={config.teamId || 'Leave blank to use current team'}
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />

            <button
              onClick={() => registerWebhookMutation.mutate()}
              disabled={registerWebhookMutation.isPending}
              className="w-full px-3 py-2 mt-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {registerWebhookMutation.isPending ? 'Registering...' : 'Register Webhook'}
            </button>

            {webhookResult && (
              <div
                className={`text-xs p-2 rounded mt-2 ${
                  webhookResult.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400'
                }`}
              >
                {webhookResult.type === 'success' ? '✓ ' : '✗ '}
                {webhookResult.message}
                {config.webhookId && (
                  <div className="mt-1">Webhook ID: {config.webhookId}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function GithubSection({
  projectId,
  config,
  onSuccess,
}: {
  projectId: string
  config: IntegrationConfig['github']
  onSuccess: () => void
}) {
  const [token, setToken] = useState('')
  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [result, setResult] = useState<{
    type: 'success' | 'error'
    message: string
    user?: { login: string; name: string }
  } | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/projects/${projectId}/settings/github/test`, {
        method: 'POST',
        body: JSON.stringify({ token, owner, repo }),
      }),
    onSuccess: (res) => {
      setResult({
        type: 'success',
        message: res.data.message,
        user: res.data.user,
      })
      setToken('')
      setOwner('')
      setRepo('')
      onSuccess()
    },
    onError: (error) => {
      setResult({
        type: 'error',
        message: error.message,
      })
    },
  })

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold uppercase text-muted-foreground">
          GitHub Integration
        </h2>
        {config.configured ? (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Configured
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <XCircle className="h-4 w-4" />
            Not configured
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Owner
            </label>
            <input
              type="text"
              placeholder={config.owner || 'github-org'}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Repo
            </label>
            <input
              type="text"
              placeholder={config.repo || 'repo-name'}
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Personal Access Token
          </label>
          <input
            type="password"
            placeholder={
              config.configured ? '●●●●●●●●●●●● (update to change)' : 'github_pat_...'
            }
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <button
          onClick={() => mutation.mutate()}
          disabled={!token || mutation.isPending}
          className="w-full px-3 py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {mutation.isPending ? 'Testing...' : 'Test & Save'}
        </button>

        {result && (
          <div
            className={`text-xs p-2 rounded ${
              result.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-red-500/10 text-red-600 dark:text-red-400'
            }`}
          >
            {result.type === 'success' ? '✓ ' : '✗ '}
            {result.message}
            {result.user && <div className="mt-1">User: {result.user.login}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

function SlackSection({
  projectId,
  config,
  onSuccess,
}: {
  projectId: string
  config: IntegrationConfig['slack']
  onSuccess: () => void
}) {
  const [webhookUrl, setWebhookUrl] = useState('')
  const [channelId, setChannelId] = useState('')
  const [result, setResult] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/projects/${projectId}/settings/slack/test`, {
        method: 'POST',
        body: JSON.stringify({ webhookUrl, channelId }),
      }),
    onSuccess: (res) => {
      setResult({
        type: 'success',
        message: res.data.message,
      })
      setWebhookUrl('')
      setChannelId('')
      onSuccess()
    },
    onError: (error) => {
      setResult({
        type: 'error',
        message: error.message,
      })
    },
  })

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold uppercase text-muted-foreground">
          Slack Integration
        </h2>
        {config.configured ? (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Configured
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <XCircle className="h-4 w-4" />
            Not configured
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Incoming Webhook URL
          </label>
          <input
            type="password"
            placeholder="https://hooks.slack.com/services/..."
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Channel ID (optional)
          </label>
          <input
            type="text"
            placeholder={config.channelId || 'C123456'}
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <button
          onClick={() => mutation.mutate()}
          disabled={!webhookUrl || mutation.isPending}
          className="w-full px-3 py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {mutation.isPending ? 'Testing...' : 'Test & Save'}
        </button>

        {result && (
          <div
            className={`text-xs p-2 rounded ${
              result.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-red-500/10 text-red-600 dark:text-red-400'
            }`}
          >
            {result.type === 'success' ? '✓ ' : '✗ '}
            {result.message}
          </div>
        )}
      </div>
    </div>
  )
}
