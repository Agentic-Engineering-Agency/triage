import type { ComponentType } from "react"
import { TriageCard } from "./triage-card"
import { WorkflowTimeline } from "./workflow-timeline"

/**
 * Static tool → component map for Mastra generative UI.
 *
 * Keys must match the toolKey used when registering tools with the Mastra agent.
 * Tool parts arrive as `tool-{toolKey}` in message.parts with states:
 *   - input-streaming / input-available → show loading
 *   - output-available → render component with part.output
 *   - output-error → show error with part.errorText
 *
 * Add new tool types here as they are implemented in runtime/src/mastra/tools/.
 */
export const toolComponents: Record<string, ComponentType<any>> = {
  // Keys must match the object keys in orchestrator's `tools: { ... }`.
  // Mastra uses the object key (not the tool's `id`) as the tool name in the stream.
  displayTriageTool: TriageCard,
  displayDuplicateTool: DuplicatePrompt,
  workflowTimeline: WorkflowTimeline,
}

/**
 * Duplicate detection prompt card.
 * Renders when the agent detects a similar existing ticket.
 */
export function DuplicatePrompt({
  existingTicketTitle,
  existingTicketUrl,
  similarity,
  onUpdateExisting,
  onCreateNew,
}: {
  existingTicketTitle?: string
  existingTicketUrl?: string
  similarity?: number
  onUpdateExisting?: () => void
  onCreateNew?: () => void
}) {
  return (
    <div className="rounded-xl bg-card p-4 shadow-neu-raised border border-dashed border-orange">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-orange/20 px-2 py-0.5 text-xs font-medium text-orange">
          Possible Duplicate
        </span>
        {similarity !== undefined && (
          <span className="text-xs text-muted-foreground">
            {Math.round(similarity * 100)}% similar
          </span>
        )}
      </div>

      {existingTicketTitle && (
        <p className="text-sm font-medium mb-1">{existingTicketTitle}</p>
      )}

      {existingTicketUrl && (
        <a
          href={existingTicketUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-secondary hover:text-secondary/80 mb-3 block"
        >
          View existing ticket →
        </a>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <button
          onClick={onUpdateExisting}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Update Existing
        </button>
        <button
          onClick={onCreateNew}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground shadow-neu-sm"
        >
          Create New
        </button>
      </div>
    </div>
  )
}
