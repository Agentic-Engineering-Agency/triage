import { createLazyFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
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

type ColumnKey = "backlog" | "todo" | "in_progress" | "in_review" | "done"

// ---------------------------------------------------------------------------
// Column definitions — ordered left-to-right in the natural workflow:
// Backlog → Todo → In Progress → In Review → Done.
// Triage-state issues (from fresh intake, before the agent classifies them)
// fall into Backlog via stateToColumn so they are never hidden.
// ---------------------------------------------------------------------------

const COLUMNS: {
  key: ColumnKey
  title: string
  icon: React.ElementType
  accent: string
  bg: string
}[] = [
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
    key: "in_review",
    title: "In Review",
    icon: AlertTriangle,
    accent: "text-amber-500",
    bg: "bg-amber-500/10",
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

/** Map a Linear state name to a board column */
function stateToColumn(stateName: string | undefined | null): ColumnKey {
  if (!stateName) return "backlog"
  const lower = stateName.toLowerCase()
  // Triage is a workflow-internal staging state — fold it into Backlog so
  // nothing disappears when the column is absent from the board.
  if (lower === "triage" || lower === "backlog") return "backlog"
  if (lower === "todo") return "todo"
  if (lower === "in review" || lower === "review") return "in_review"
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

// ---------------------------------------------------------------------------
// API fetch
// ---------------------------------------------------------------------------

interface GroupedIssue {
  id: string
  identifier: string
  title: string
  priority: number
  url: string
  createdAt: string
  assignee?: { id: string; name: string } | null
}

const INITIALS_COLORS = [
  "bg-primary/80",
  "bg-violet-500/80",
  "bg-emerald-500/80",
  "bg-amber-500/80",
  "bg-rose-500/80",
  "bg-sky-500/80",
]

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function colorFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return INITIALS_COLORS[Math.abs(h) % INITIALS_COLORS.length]
}

async function fetchLinearIssues(): Promise<BoardTicket[]> {
  // Call our dedicated endpoint which returns issues already grouped by
  // Linear state name. This avoids the empty-query validation error from
  // the generic search-linear-issues tool and gives us richer data
  // (assignee, project, labels) in a single round trip.
  const res = await fetch("/api/linear/issues", {
    method: "GET",
    headers: { Accept: "application/json" },
  })

  if (!res.ok) {
    throw new Error(`Linear API returned ${res.status}`)
  }

  const json = (await res.json()) as {
    success: boolean
    data?: Record<string, GroupedIssue[]>
    error?: { message?: string }
  }
  if (!json.success || !json.data) {
    throw new Error(json.error?.message ?? "No issues returned")
  }

  const tickets: BoardTicket[] = []
  for (const [stateName, issues] of Object.entries(json.data)) {
    for (const issue of issues) {
      tickets.push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        severity: priorityToSeverity(issue.priority),
        priority: issue.priority,
        assignee: issue.assignee
          ? {
              name: issue.assignee.name,
              initials: initialsFor(issue.assignee.name),
              color: colorFor(issue.assignee.id),
            }
          : null,
        createdAt: issue.createdAt ?? new Date().toISOString(),
        url: issue.url,
        column: stateToColumn(stateName),
      })
    }
  }
  return tickets
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function BoardPage() {
  const [searchQuery, setSearchQuery] = useState("")
  // Last known-good snapshot. Preserved across transient Linear API errors
  // so a backend outage doesn't masquerade as "no incidents" on an SRE board.
  const [lastGoodTickets, setLastGoodTickets] = useState<BoardTicket[] | null>(
    null,
  )

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

  // Capture the latest successful snapshot.
  useEffect(() => {
    if (!isError && tickets) {
      setLastGoodTickets(tickets)
    }
  }, [tickets, isError])

  // Prefer live tickets, fall back to the last known-good snapshot on error.
  // Never silently collapse to an empty board on an API failure.
  const isLive = !isError && !!tickets
  const isStale = isError && !!lastGoodTickets
  const displayTickets: BoardTicket[] = isLive
    ? tickets
    : isStale
      ? lastGoodTickets
      : []

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
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
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
              ) : isStale ? (
                <>
                  <CircleDot className="inline h-3 w-3 mr-1 text-amber-500" />
                  Last known snapshot — Linear API unreachable
                </>
              ) : (
                <>
                  <CircleDot className="inline h-3 w-3 mr-1 text-destructive" />
                  Linear API unreachable — unable to load tickets
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
        {isError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {isStale
                  ? "Linear API unreachable — showing last successful snapshot."
                  : "Linear API unreachable — unable to load tickets."}
              </span>
            </div>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-background/40 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-background/80 transition-colors disabled:opacity-50"
            >
              {isFetching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Retry
            </button>
          </div>
        )}
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
  // Guard createdAt: the backend may serialize it as undefined or a raw
  // unparseable string, and Intl.DateTimeFormat throws RangeError on an
  // Invalid Date in some locales. Omit the chip entirely when unparseable.
  const parsed = ticket.createdAt ? new Date(ticket.createdAt) : null
  const formattedDate =
    parsed && Number.isFinite(parsed.getTime())
      ? new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
        }).format(parsed)
      : null

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
        {formattedDate && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formattedDate}
          </div>
        )}
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
