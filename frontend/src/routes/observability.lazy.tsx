import { createLazyFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCurrentProjectId } from '@/components/project-selector'
import {
  Activity,
  ChevronDown,
  ChevronRight,
  DollarSign,
  FolderGit2,
  RefreshCw,
  Zap,
} from 'lucide-react'

export const Route = createLazyFileRoute('/observability')({
  component: ObservabilityPage,
})

// ---------- Types ----------

interface StatsData {
  totalRuns: number
  runsByStatus: { running: number; suspended: number; completed: number }
  totalCost: number
  totalTokens: number
  totalCalls: number
}

interface CostByModel {
  model: string
  displayName: string
  totalCost: number
  totalInput: number
  totalOutput: number
  callCount: number
}

interface CostByDay {
  date: string
  totalCost: number
  callCount: number
}

interface CostsData {
  byModel: CostByModel[]
  byDay: CostByDay[]
  totals: {
    totalCost: number
    totalInput: number
    totalOutput: number
    totalCalls: number
  }
}

interface WorkflowRun {
  runId: string
  threadId: string
  issueId: string
  issueUrl: string
  status: string
  createdAt: string
}

interface AgentUsage {
  agentId: string
  totalCalls: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
  avgDurationMs: number
}

interface PricingModel {
  modelId: string
  displayName: string
  inputPer1M: number
  outputPer1M: number
  isFree: boolean
}

interface PricingData {
  models: PricingModel[]
}

// ---------- Helpers ----------

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`
}

function formatCostShort(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`
  return `$${value.toFixed(4)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`
  return `${(ms / 1_000).toFixed(1)}s`
}

function formatTimeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

// ---------- Sub-components ----------

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { dotColor: string; textColor: string; label: string }> = {
    completed: { dotColor: 'bg-green-500', textColor: 'text-green-400', label: 'Completed' },
    suspended: { dotColor: 'bg-amber-500', textColor: 'text-amber-400', label: 'Suspended' },
    running: { dotColor: 'bg-blue-500', textColor: 'text-blue-400', label: 'Running' },
  }
  const c = config[status] ?? { dotColor: 'bg-gray-500', textColor: 'text-gray-400', label: status }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${c.textColor}`}>
      <span className={`w-2 h-2 rounded-full ${c.dotColor}`} />
      {c.label}
    </span>
  )
}

function StatusPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-${color}-500/10 text-${color}-400 font-medium`}>
      <span className={`w-1.5 h-1.5 rounded-full bg-${color}-500`} />
      {count} {label}
    </span>
  )
}

// ---------- Main Page ----------

function ObservabilityPage() {
  const [currentProjectId] = useCurrentProjectId()
  const navigate = useNavigate()
  const [pricingOpen, setPricingOpen] = useState(false)

  const REFETCH_INTERVAL = 60_000

  const { data: stats, isLoading: statsLoading, dataUpdatedAt: statsUpdatedAt } = useQuery<StatsData>({
    queryKey: ['observability-stats'],
    queryFn: () => apiFetch('/observability/stats'),
    refetchInterval: REFETCH_INTERVAL,
    enabled: !!currentProjectId,
  })

  const { data: costs, isLoading: costsLoading } = useQuery<CostsData>({
    queryKey: ['observability-costs'],
    queryFn: () => apiFetch('/observability/costs'),
    refetchInterval: REFETCH_INTERVAL,
    enabled: !!currentProjectId,
  })

  const { data: workflows, isLoading: workflowsLoading } = useQuery<WorkflowRun[]>({
    queryKey: ['observability-workflows'],
    queryFn: () => apiFetch('/observability/workflows'),
    refetchInterval: REFETCH_INTERVAL,
    enabled: !!currentProjectId,
  })

  const { data: agents, isLoading: agentsLoading } = useQuery<AgentUsage[]>({
    queryKey: ['observability-agents'],
    queryFn: () => apiFetch('/observability/agents'),
    refetchInterval: REFETCH_INTERVAL,
    enabled: !!currentProjectId,
  })

  const { data: pricing } = useQuery<PricingData>({
    queryKey: ['observability-pricing'],
    queryFn: () => apiFetch('/observability/pricing'),
    staleTime: 300_000,
    enabled: !!currentProjectId,
  })

  // Gate: require a project to be selected
  if (!currentProjectId) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FolderGit2 className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-heading font-semibold mb-2">
            Select or create a project to view observability
          </h2>
          <p className="text-muted-foreground text-sm mb-4">
            A project is required before you can use the observability dashboard.
          </p>
          <button
            onClick={() => navigate({ to: '/projects' })}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-neu-sm hover:opacity-90 transition-opacity"
          >
            <FolderGit2 className="h-4 w-4" />
            Go to Projects
          </button>
        </div>
      </div>
    )
  }

  const successRate =
    stats && stats.totalRuns > 0
      ? ((stats.runsByStatus.completed / stats.totalRuns) * 100).toFixed(1)
      : '0.0'

  const isLoading = statsLoading || costsLoading || workflowsLoading || agentsLoading

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-heading font-semibold text-foreground">
              Observability
            </h1>
            <p className="text-xs text-muted-foreground">
              Workflow runs, costs, and agent metrics
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            {statsUpdatedAt
              ? `Updated ${formatTimeAgo(new Date(statsUpdatedAt).toISOString())}`
              : 'Loading...'}
          </span>
          <span className="text-[10px] text-muted-foreground/60 px-2 py-0.5 rounded-full bg-muted">
            Auto-refresh 60s
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Workflow Runs */}
          <div className="rounded-xl bg-card p-4 shadow-neu-raised">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Workflow Runs</span>
            </div>
            {statsLoading ? (
              <div className="h-8 w-20 rounded bg-muted animate-pulse mt-1" />
            ) : (
              <>
                <div className="text-2xl font-heading font-semibold">{stats?.totalRuns ?? 0}</div>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {(stats?.runsByStatus.completed ?? 0) > 0 && (
                    <StatusPill label="done" count={stats!.runsByStatus.completed} color="green" />
                  )}
                  {(stats?.runsByStatus.suspended ?? 0) > 0 && (
                    <StatusPill label="suspended" count={stats!.runsByStatus.suspended} color="amber" />
                  )}
                  {(stats?.runsByStatus.running ?? 0) > 0 && (
                    <StatusPill label="running" count={stats!.runsByStatus.running} color="blue" />
                  )}
                </div>
              </>
            )}
          </div>

          {/* Success Rate */}
          <div className="rounded-xl bg-card p-4 shadow-neu-raised">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Success Rate</span>
            </div>
            {statsLoading ? (
              <div className="h-8 w-20 rounded bg-muted animate-pulse mt-1" />
            ) : (
              <>
                <div className="text-2xl font-heading font-semibold text-green-400">{successRate}%</div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {stats?.runsByStatus.completed ?? 0} completed of {stats?.totalRuns ?? 0}
                </p>
              </>
            )}
          </div>

          {/* Total Cost */}
          <div className="rounded-xl bg-card p-4 shadow-neu-raised">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Cost</span>
            </div>
            {statsLoading ? (
              <div className="h-8 w-20 rounded bg-muted animate-pulse mt-1" />
            ) : (
              <>
                <div className="text-2xl font-heading font-semibold">{formatCostShort(stats?.totalCost ?? 0)}</div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {formatTokens(stats?.totalTokens ?? 0)} tokens used
                </p>
              </>
            )}
          </div>

          {/* Total API Calls */}
          <div className="rounded-xl bg-card p-4 shadow-neu-raised">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total API Calls</span>
            </div>
            {statsLoading ? (
              <div className="h-8 w-20 rounded bg-muted animate-pulse mt-1" />
            ) : (
              <div className="text-2xl font-heading font-semibold">{(stats?.totalCalls ?? 0).toLocaleString()}</div>
            )}
          </div>
        </div>

        {/* Cost Breakdown Section */}
        <div className="rounded-xl bg-card p-4 shadow-neu-raised">
          <h2 className="text-sm font-heading font-semibold mb-3">Cost Breakdown by Model</h2>
          {costsLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-8 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : costs?.byModel && costs.byModel.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border/50">
                    <th className="pb-2 pr-4 font-medium">Model</th>
                    <th className="pb-2 pr-4 font-medium text-right">Calls</th>
                    <th className="pb-2 pr-4 font-medium text-right">Input Tokens</th>
                    <th className="pb-2 pr-4 font-medium text-right">Output Tokens</th>
                    <th className="pb-2 font-medium text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {costs.byModel.map((row) => (
                    <tr key={row.model} className="border-b border-border/50">
                      <td className="py-2 pr-4">
                        <span className="font-medium">{row.displayName}</span>
                        <span className="text-[10px] text-muted-foreground ml-1.5">{row.model}</span>
                      </td>
                      <td className="py-2 pr-4 text-right text-muted-foreground">{row.callCount.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right text-muted-foreground">{formatTokens(row.totalInput)}</td>
                      <td className="py-2 pr-4 text-right text-muted-foreground">{formatTokens(row.totalOutput)}</td>
                      <td className="py-2 text-right font-medium">{formatCost(row.totalCost)}</td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr className="font-medium">
                    <td className="pt-2 pr-4">Total</td>
                    <td className="pt-2 pr-4 text-right">{costs.totals.totalCalls.toLocaleString()}</td>
                    <td className="pt-2 pr-4 text-right">{formatTokens(costs.totals.totalInput)}</td>
                    <td className="pt-2 pr-4 text-right">{formatTokens(costs.totals.totalOutput)}</td>
                    <td className="pt-2 text-right">{formatCost(costs.totals.totalCost)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No cost data available yet.</p>
          )}
        </div>

        {/* Recent Workflow Runs */}
        <div className="rounded-xl bg-card p-4 shadow-neu-raised">
          <h2 className="text-sm font-heading font-semibold mb-3">Recent Workflow Runs</h2>
          {workflowsLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-8 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : workflows && workflows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border/50">
                    <th className="pb-2 pr-4 font-medium">Time</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Issue</th>
                    <th className="pb-2 font-medium">Run ID</th>
                  </tr>
                </thead>
                <tbody>
                  {workflows.slice(0, 20).map((run) => (
                    <tr key={run.runId} className="border-b border-border/50">
                      <td className="py-2 pr-4 text-muted-foreground">{formatTimeAgo(run.createdAt)}</td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="py-2 pr-4">
                        {run.issueUrl ? (
                          <a
                            href={run.issueUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline font-medium"
                          >
                            {run.issueId}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">{run.issueId || '-'}</span>
                        )}
                      </td>
                      <td className="py-2 text-[11px] text-muted-foreground font-mono truncate max-w-[200px]">
                        {run.runId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No workflow runs recorded yet.</p>
          )}
        </div>

        {/* Agent Usage */}
        <div className="rounded-xl bg-card p-4 shadow-neu-raised">
          <h2 className="text-sm font-heading font-semibold mb-3">Agent Usage</h2>
          {agentsLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-8 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : agents && agents.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border/50">
                    <th className="pb-2 pr-4 font-medium">Agent</th>
                    <th className="pb-2 pr-4 font-medium text-right">Calls</th>
                    <th className="pb-2 pr-4 font-medium text-right">Input Tokens</th>
                    <th className="pb-2 pr-4 font-medium text-right">Output Tokens</th>
                    <th className="pb-2 pr-4 font-medium text-right">Cost</th>
                    <th className="pb-2 font-medium text-right">Avg Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr key={agent.agentId} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium">{agent.agentId}</td>
                      <td className="py-2 pr-4 text-right text-muted-foreground">{agent.totalCalls.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right text-muted-foreground">{formatTokens(agent.totalInputTokens)}</td>
                      <td className="py-2 pr-4 text-right text-muted-foreground">{formatTokens(agent.totalOutputTokens)}</td>
                      <td className="py-2 pr-4 text-right font-medium">{formatCost(agent.totalCost)}</td>
                      <td className="py-2 text-right text-muted-foreground">{formatDuration(agent.avgDurationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No agent usage data yet.</p>
          )}
        </div>

        {/* Pricing Reference (collapsible) */}
        <div className="rounded-xl bg-card p-4 shadow-neu-raised">
          <button
            onClick={() => setPricingOpen(!pricingOpen)}
            className="flex items-center gap-2 w-full text-left"
          >
            {pricingOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <h2 className="text-sm font-heading font-semibold">Pricing Reference</h2>
            <span className="text-[10px] text-muted-foreground">(click to {pricingOpen ? 'collapse' : 'expand'})</span>
          </button>
          {pricingOpen && pricing?.models && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border/50">
                    <th className="pb-2 pr-4 font-medium">Model</th>
                    <th className="pb-2 pr-4 font-medium text-right">Input / 1M tokens</th>
                    <th className="pb-2 pr-4 font-medium text-right">Output / 1M tokens</th>
                    <th className="pb-2 font-medium text-right">Free Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {pricing.models.map((model) => (
                    <tr key={model.modelId} className="border-b border-border/50">
                      <td className="py-2 pr-4">
                        <span className="font-medium">{model.displayName}</span>
                        <span className="text-[10px] text-muted-foreground ml-1.5">{model.modelId}</span>
                      </td>
                      <td className="py-2 pr-4 text-right text-muted-foreground">{formatCostShort(model.inputPer1M)}</td>
                      <td className="py-2 pr-4 text-right text-muted-foreground">{formatCostShort(model.outputPer1M)}</td>
                      <td className="py-2 text-right">
                        {model.isFree ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 font-medium">Yes</span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
