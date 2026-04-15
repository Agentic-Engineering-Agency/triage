import { cn } from "@/lib/utils"
import { SeverityBadge, type Severity } from "./severity-badge"
import { ConfidenceScore } from "./confidence-score"
import { FileReference } from "./file-reference"
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"

export type TriageCardState = "loading" | "pending" | "confirmed" | "error"

export interface TriageCardProps {
  state: TriageCardState
  title?: string
  severity?: Severity
  confidence?: number
  summary?: string
  fileReferences?: Array<{ filePath: string; lineNumber?: number }>
  proposedFix?: string
  linearUrl?: string
  assigneeId?: string
  assigneeName?: string
  assigneeEmail?: string
  errorMessage?: string
  isSubmitting?: boolean
  onCreateTicket?: () => void
  onRetry?: () => void
  className?: string
}

export function TriageCard({
  state,
  title,
  severity,
  confidence,
  summary,
  fileReferences,
  proposedFix,
  linearUrl,
  assigneeName,
  errorMessage,
  isSubmitting = false,
  onCreateTicket,
  onRetry,
  className,
}: TriageCardProps) {
  // Normalize confidence from 0-1 (agent schema) to 0-100 (UI display)
  const normalizedConfidence = confidence !== undefined
    ? (confidence <= 1 ? Math.round(confidence * 100) : Math.round(confidence))
    : undefined

  if (state === "loading") {
    return (
      <div
        className={cn(
          "rounded-xl bg-card p-4 shadow-neu-raised animate-pulse",
          className,
        )}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="h-5 w-16 rounded bg-muted" />
          <div className="h-4 w-12 rounded bg-muted" />
        </div>
        <div className="h-5 w-3/4 rounded bg-muted mb-2" />
        <div className="h-4 w-full rounded bg-muted mb-1" />
        <div className="h-4 w-2/3 rounded bg-muted" />
      </div>
    )
  }

  const isLowConfidence = normalizedConfidence !== undefined && normalizedConfidence < 60

  return (
    <div
      className={cn(
        "rounded-xl bg-card p-4 shadow-neu-raised",
        {
          "border border-dashed border-orange": state === "pending",
          "border border-solid border-steel-blue": state === "confirmed",
          "border border-solid border-coral": state === "error",
        },
        isLowConfidence && state === "pending" && "opacity-85",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        {severity && <SeverityBadge severity={severity} />}
        {normalizedConfidence !== undefined && <ConfidenceScore score={normalizedConfidence} />}
      </div>

      {/* Assignee */}
      {assigneeName && (
        <div className="mb-2 text-xs text-muted-foreground">
          Assigned to: <span className="font-medium text-foreground">{assigneeName}</span>
        </div>
      )}

      {/* Title */}
      {title && (
        <h3 className="font-heading text-base font-semibold mb-2">{title}</h3>
      )}

      {/* Low confidence warning */}
      {isLowConfidence && state === "pending" && (
        <div className="mb-2 rounded-lg bg-coral/10 border border-coral/30 px-3 py-1.5 text-xs text-coral">
          Low confidence — verify before creating
        </div>
      )}

      {/* Summary */}
      {summary && (
        <p className="text-sm text-muted-foreground mb-3 line-clamp-3">
          {summary}
        </p>
      )}

      {/* File references */}
      {fileReferences && fileReferences.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {fileReferences.map((ref, i) => (
            <FileReference
              key={i}
              filePath={ref.filePath}
              lineNumber={ref.lineNumber}
            />
          ))}
        </div>
      )}

      {/* Proposed fix */}
      {proposedFix && (
        <details className="mb-3 group">
          <summary className="text-xs font-medium text-secondary cursor-pointer hover:text-secondary/80">
            Proposed Fix
          </summary>
          <p className="mt-1.5 text-sm text-muted-foreground pl-2 border-l-2 border-muted">
            {proposedFix}
          </p>
        </details>
      )}

      {/* Error state */}
      {state === "error" && errorMessage && (
        <p className="text-sm text-destructive mb-3">{errorMessage}</p>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-border">
        {state === "pending" && (
          <Button size="sm" onClick={onCreateTicket} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Ticket"}
          </Button>
        )}
        {state === "confirmed" && (
          linearUrl ? (
            <a
              href={linearUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-secondary/80"
            >
              <ExternalLink className="h-3 w-3" />
              View in Linear
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">Ticket created ✓</span>
          )
        )}
        {state === "error" && (
          <Button size="sm" variant="destructive" onClick={onRetry}>
            Try Again
          </Button>
        )}
      </div>
    </div>
  )
}
