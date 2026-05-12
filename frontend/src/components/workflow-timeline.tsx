import { Check, Loader2, Pause, AlertCircle, ExternalLink, Mail, Hash, FileSearch, Ticket, Bell } from "lucide-react"
import { cn } from "@/lib/utils"

export interface WorkflowStep {
  step: string
  status: "running" | "completed" | "error" | "suspended"
  message?: string
  data?: Record<string, unknown>
}

export interface WorkflowTimelineProps {
  steps: WorkflowStep[]
  /** True while events are still streaming; false after the workflow suspends or completes */
  active?: boolean
}

// Human-friendly labels for each stepId
const STEP_LABELS: Record<string, string> = {
  intake: "Analyzing incident",
  triage: "Classifying severity",
  dedup: "Checking for duplicates",
  ticket: "Creating Linear issue",
  notify: "Sending notifications",
  "notify-email": "Emailing assignee",
  "notify-slack": "Posting to Slack",
  suspend: "Waiting for resolution",
  "notify-resolution": "Sending resolution notice",
  done: "Workflow complete",
}

function stepLabel(stepId: string): string {
  return STEP_LABELS[stepId] ?? stepId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function StepIcon({ step, status }: { step: string; status: WorkflowStep["status"] }) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
  }
  if (status === "error") {
    return <AlertCircle className="h-3.5 w-3.5 text-destructive" />
  }
  if (status === "suspended") {
    return <Pause className="h-3.5 w-3.5 text-amber-500 fill-amber-500/20" />
  }

  // completed — use a topic-specific icon in muted green
  const Icon =
    step === "ticket" ? Ticket :
    step === "notify-email" ? Mail :
    step === "notify-slack" ? Hash :
    step === "dedup" ? FileSearch :
    step === "notify" || step === "notify-resolution" ? Bell :
    Check

  return <Icon className="h-3.5 w-3.5 text-emerald-500" />
}

export function WorkflowTimeline({ steps, active = false }: WorkflowTimelineProps) {
  if (!steps || steps.length === 0) return null

  // Derive overall state from last step
  const last = steps[steps.length - 1]
  const suspended = last.status === "suspended"
  const errored = steps.some((s) => s.status === "error")
  const done = !active && !suspended && !errored

  // Find the Linear URL if any ticket step has it
  const linearUrl = (() => {
    for (const s of steps) {
      const url = (s.data as { issueUrl?: string } | undefined)?.issueUrl
      if (url) return url
    }
    return undefined
  })()

  const issueId = (() => {
    for (const s of steps) {
      const id = (s.data as { issueId?: string } | undefined)?.issueId
      if (id && id.startsWith("TRI-")) return id
    }
    return undefined
  })()

  const headerText = errored
    ? "Workflow failed"
    : suspended
      ? "Workflow paused — waiting"
      : done
        ? "Workflow complete"
        : "Workflow in progress"

  return (
    <div className="rounded-xl bg-card p-4 shadow-neu-raised border border-border/50">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          {active ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : errored ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : suspended ? (
            <Pause className="h-4 w-4 text-amber-500" />
          ) : (
            <Check className="h-4 w-4 text-emerald-500" />
          )}
          <span className="text-sm font-heading font-semibold">{headerText}</span>
        </div>
        {issueId && (
          <span className="text-[11px] font-mono text-muted-foreground">{issueId}</span>
        )}
      </div>

      {/* Steps */}
      <ol className="space-y-1.5">
        {steps.map((s, i) => {
          const label = s.message && !s.message.endsWith("...") ? s.message : stepLabel(s.step)
          return (
            <li key={`${s.step}-${i}`} className="flex items-start gap-2.5 text-[13px]">
              <div className="mt-0.5 shrink-0">
                <StepIcon step={s.step} status={s.status} />
              </div>
              <div className="flex-1 min-w-0">
                <span
                  className={cn(
                    "leading-snug",
                    s.status === "running" && "text-foreground",
                    s.status === "completed" && "text-muted-foreground",
                    s.status === "error" && "text-destructive",
                    s.status === "suspended" && "text-amber-600 dark:text-amber-500",
                  )}
                >
                  {label}
                </span>
              </div>
            </li>
          )
        })}
      </ol>

      {/* Footer action */}
      {linearUrl && (
        <div className="flex items-center gap-2 pt-3 mt-3 border-t border-border/50">
          <a
            href={linearUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-secondary/80"
          >
            <ExternalLink className="h-3 w-3" />
            View in Linear
          </a>
        </div>
      )}
    </div>
  )
}
