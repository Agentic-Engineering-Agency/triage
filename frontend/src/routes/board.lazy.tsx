import { createLazyFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import {
  LayoutGrid,
  RefreshCw,
  Loader2,
  ExternalLink,
  Clock,
  AlertTriangle,
  Inbox,
  CircleDot,
  CheckCircle2,
  ListTodo,
  Timer,
  Search,
} from "lucide-react"
import { SeverityBadge, type Severity } from "@/components/severity-badge"

export const Route = createLazyFileRoute('/board')({ component: BoardPage })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LinearIssue {
  id: string
  identifier: string
  title: string
  state: { id: string; name: string } | null
  priority: number
  url: string
}

interface BoardTicket {
  id: string
  identifier: string
  title: string
  severity: Severity
  priority: number
  assignee: { name: string; initials: string; color: string } | null
  createdAt: string
  url: string
  column: ColumnKey
}

type ColumnKey = "triage" | "backlog" | "todo" | "in_progress" | "done"

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const COLUMNS: {
  key: ColumnKey
  title: string
  icon: React.ElementType
  accent: string
  bg: string
}[] = [
  {
    key: "triage",
    title: "Triage",
    icon: AlertTriangle,
    accent: "text-amber-500",
    bg: "bg-amber-500/10",
  },
  {
    key: "backlog",
    title: "Backlog",
    icon: Inbox,
    accent: "text-slate-400",
    bg: "bg-slate-400/10",
  },
  {
    key: "todo",
    title: "Todo",
    icon: ListTodo,
    accent: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    key: "in_progress",
    title: "In Progress",
    icon: Timer,
    accent: "text-violet-500",
    bg: "bg-violet-500/10",
  },
  {
    key: "done",
    title: "Done",
    icon: CheckCircle2,
    accent: "text-emerald-500",
    bg: "bg-emerald-500/10",
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEAM_ID = "645a639b-39e2-4abe-8ded-3346d2f79f9f"

/** Map a Linear state name to a board column */
function stateToColumn(stateName: string | undefined | null): ColumnKey {
  if (!stateName) return "backlog"
  const lower = stateName.toLowerCase()
  if (lower === "triage") return "triage"
  if (lower === "backlog") return "backlog"
  if (lower === "todo") return "todo"
  if (lower.includes("progress") || lower === "started" || lower === "in progress")
    return "in_progress"
  if (
    lower === "done" ||
    lower === "closed" ||
    lower === "completed" ||
    lower === "canceled" ||
    lower === "cancelled"
  )
    return "done"
  return "backlog"
}

/** Map Linear priority number (0=none, 1=urgent, 2=high, 3=medium, 4=low) to severity */
function priorityToSeverity(priority: number): Severity {
  switch (priority) {
    case 1:
      return "critical"
    case 2:
      return "high"
    case 3:
      return "medium"
    case 4:
      return "low"
    default:
      return "medium"
  }
}

/** Generate demo data for when the API is not available */
function getDemoTickets(): BoardTicket[] {
  return [
    {
      id: "demo-1",
      identifier: "TRI-42",
      title: "Payment gateway timeout on checkout — Solidus::PaymentProcessing",
      severity: "critical",
      priority: 1,
      assignee: { name: "Fernando", initials: "FE", color: "bg-primary/80" },
      createdAt: "2026-04-09T08:23:00Z",
      url: "#",
      column: "triage",
    },
    {
      id: "demo-2",
      identifier: "TRI-41",
      title: "Spree::Order state machine stuck in 'payment' state after 3DS redirect",
      severity: "high",
      priority: 2,
      assignee: { name: "Koki", initials: "KO", color: "bg-violet-500/80" },
      createdAt: "2026-04-09T07:15:00Z",
      url: "#",
      column: "in_progress",
    },
    {
      id: "demo-3",
      identifier: "TRI-40",
      title: "Inventory sync mismatch — stock_items count diverges from warehouse API",
      severity: "high",
      priority: 2,
      assignee: { name: "Lalo", initials: "LA", color: "bg-emerald-500/80" },
      createdAt: "2026-04-08T22:10:00Z",
      url: "#",
      column: "todo",
    },
    {
      id: "demo-4",
      identifier: "TRI-39",
      title: "Taxjar rate calculation returns 0% for CA addresses",
      severity: "medium",
      priority: 3,
      assignee: null,
      createdAt: "2026-04-08T18:45:00Z",
      url: "#",
      column: "backlog",
    },
    {
      id: "demo-5",
      identifier: "TRI-38",
      title: "Promotion rule evaluation order causes double discount on bundles",
      severity: "medium",
      priority: 3,
      assignee: { name: "Chenko", initials: "CH", color: "bg-amber-500/80" },
      createdAt: "2026-04-08T14:30:00Z",
      url: "#",
      column: "todo",
    },
    {
      id: "demo-6",
      identifier: "TRI-37",
      title: "ActionMailer delivery failure — SMTP connection reset on order confirmation",
      severity: "low",
      priority: 4,
      assignee: { name: "Fernando", initials: "FE", color: "bg-primary/80" },
      createdAt: "2026-04-08T11:20:00Z",
      url: "#",
      column: "done",
    },
    {
      id: "demo-7",
      identifier: "TRI-36",
      title: "Shipment tracking webhook returns 404 for FedEx SmartPost",
      severity: "low",
      priority: 4,
      assignee: { name: "Koki", initials: "KO", color: "bg-violet-500/80" },
      createdAt: "2026-04-07T16:55:00Z",
      url: "#",
      column: "done",
    },
    {
      id: "demo-8",
      identifier: "TRI-35",
      title: "Redis cache stampede on product page during flash sale",
      severity: "critical",
      priority: 1,
      assignee: { name: "Lalo", initials: "LA", color: "bg-emerald-500/80" },
      createdAt: "2026-04-09T09:01:00Z",
      url: "#",
      column: "in_progress",
    },
    {
      id: "demo-9",
      identifier: "TRI-34",
      title: "Sidekiq job retry storm — RefundWorker hitting Linear rate limit",
      severity: "high",
      priority: 2,
      assignee: null,
      createdAt: "2026-04-08T20:00:00Z",
      url: "#",
      column: "backlog",
    },
  ]
}

// ---------------------------------------------------------------------------
// API fetch
// ---------------------------------------------------------------------------

async function fetchLinearIssues(): Promise<BoardTicket[]> {
  const res = await fetch(
    "/api/agents/orchestrator/tools/search-linear-issues/execute",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          query: "",
          teamId: TEAM_ID,
          limit: 50,
        },
      }),
    }
  )

  if (!res.ok) {
    throw new Error(`Linear API returned ${res.status}`)
  }

  const json = await res.json()

  // Mastra tool response: { results: { ... } } or the tool output directly
  const payload = json?.results ?? json
  if (!payload?.success || !payload?.data?.issues) {
    throw new Error(payload?.error ?? "No issues returned")
  }

  const issues: LinearIssue[] = payload.data.issues
  return issues.map((issue) => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    severity: priorityToSeverity(issue.priority),
    priority: issue.priority,
    assignee: null, // search endpoint doesn't return assignee
    createdAt: new Date().toISOString(),
    url: issue.url,
    column: stateToColumn(issue.state?.name),
  }))
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function BoardPage() {
  const [searchQuery, setSearchQuery] = useState("")

  const {
    data: tickets,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<BoardTicket[]>({
    queryKey: ["board-tickets"],
    queryFn: fetchLinearIssues,
    refetchInterval: 30_000,
    retry: 1,
    staleTime: 15_000,
  })

  // Fallback to demo data when the API is not reachable
  const isLive = !isError && !!tickets
  const displayTickets = isLive ? tickets : getDemoTickets()

  // Filter by search
  const filtered = searchQuery.trim()
    ? displayTickets.filter(
        (t) =>
          t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.identifier.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : displayTickets

  // Group tickets by column
  const grouped: Record<ColumnKey, BoardTicket[]> = {
    triage: [],
    backlog: [],
    todo: [],
    in_progress: [],
    done: [],
  }
  for (const ticket of filtered) {
    grouped[ticket.column].push(ticket)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <LayoutGrid className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-heading font-semibold text-foreground">
              Board
            </h1>
            <p className="text-xs text-muted-foreground">
              {isLive ? (
                <>
                  <CircleDot className="inline h-3 w-3 mr-1 text-emerald-500" />
                  Live from Linear
                </>
              ) : (
                <>
                  <CircleDot className="inline h-3 w-3 mr-1 text-amber-500" />
                  Demo mode — connect Linear to see real tickets
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search tickets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-56 rounded-xl border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Refresh */}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-neu-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid h-full grid-cols-5 gap-4 auto-rows-min">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.key}
                title={col.title}
                icon={col.icon}
                accent={col.accent}
                bg={col.bg}
                tickets={grouped[col.key]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

function KanbanColumn({
  title,
  icon: Icon,
  accent,
  bg,
  tickets,
}: {
  title: string
  icon: React.ElementType
  accent: string
  bg: string
  tickets: BoardTicket[]
}) {
  return (
    <div className="flex flex-col rounded-2xl bg-card border border-border/50 shadow-neu-sm overflow-hidden">
      {/* Column header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
        <div
          className={`flex h-6 w-6 items-center justify-center rounded-lg ${bg}`}
        >
          <Icon className={`h-3.5 w-3.5 ${accent}`} />
        </div>
        <h3 className="font-heading text-sm font-semibold text-foreground">
          {title}
        </h3>
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">
          {tickets.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-auto p-2 space-y-2">
        {tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/30 mb-2">
              <Icon className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="text-xs text-muted-foreground/60">No tickets</p>
          </div>
        ) : (
          tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} />
          ))
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ticket card
// ---------------------------------------------------------------------------

function TicketCard({ ticket }: { ticket: BoardTicket }) {
  const formattedDate = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(ticket.createdAt))

  return (
    <a
      href={ticket.url !== "#" ? ticket.url : undefined}
      target={ticket.url !== "#" ? "_blank" : undefined}
      rel="noopener noreferrer"
      className="group block rounded-xl bg-background border border-border/40 p-3 shadow-sm hover:shadow-neu-sm hover:border-border/60 transition-all cursor-pointer"
    >
      {/* Top row: identifier + severity */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-mono font-medium text-muted-foreground">
          {ticket.identifier}
        </span>
        <SeverityBadge severity={ticket.severity} />
      </div>

      {/* Title */}
      <h4 className="text-sm font-medium text-foreground leading-snug line-clamp-2 mb-3 group-hover:text-primary transition-colors">
        {ticket.title}
      </h4>

      {/* Bottom row: assignee + date */}
      <div className="flex items-center justify-between">
        {ticket.assignee ? (
          <div className="flex items-center gap-1.5">
            <div
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white ${ticket.assignee.color}`}
            >
              {ticket.assignee.initials}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {ticket.assignee.name}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px] text-muted-foreground">
              ?
            </div>
            <span className="text-[11px] text-muted-foreground/60">
              Unassigned
            </span>
          </div>
        )}
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {formattedDate}
        </div>
      </div>

      {/* External link indicator */}
      {ticket.url !== "#" && (
        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/20 text-[10px] text-muted-foreground/50 group-hover:text-primary/60 transition-colors">
          <ExternalLink className="h-3 w-3" />
          Open in Linear
        </div>
      )}
    </a>
  )
}
