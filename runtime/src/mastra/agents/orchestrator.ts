import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { createClient } from '@libsql/client';
import { MODELS } from '../../lib/config';
import { resolveOpenRouterFromContext } from '../../lib/tenant-openrouter';

// Explicit storage for memory — ensures persistence to the shared LibSQL container
const memoryStorage = new LibSQLStore({
  id: 'memory-store',
  url: process.env.LIBSQL_URL || 'http://libsql:8080',
});
import {
  getLinearIssueTool,
  listLinearIssuesTool,
  getTeamMembersTool,
  listLinearCyclesTool,
  queryWikiTool,
  generateWikiTool,
  processAttachmentsTool,
  displayTriageTool,
  displayDuplicateTool,
} from '../tools/index';

// ─── Base prompt (project-agnostic) ──────────────────────────────
// Kept as a constant so the dynamic `instructions` can reuse it and
// append per-request project context without duplication.
const BASE_INSTRUCTIONS = `You are Triage, an SRE incident triage assistant.

## Your ONE Job
Analyze incident reports and display a triage card. That's it. You gather info, classify, and show the card.

## How You Work
1. If files are attached, call process-attachments first to extract their content.
2. Search existing Linear tickets with list-linear-issues to check for duplicates.
   - If you find a likely duplicate (>70% keyword overlap), call displayDuplicateTool instead.
3. Classify the incident: severity (P0-P4), confidence score, root cause, suggested files, proposed fix.
4. Call displayTriageTool with your classification. The card IS your response — do NOT repeat the same info as text.
5. After displaying the card, tell the user: "Click **Create Ticket** when ready." Nothing else.

### Resolving the assignee
When the user mentions a person (e.g., "para Koki", "asigna a Fernando"), call get-linear-team-members first. Match the name against the list (case-insensitive, partial match) and include assigneeId, assigneeName, assigneeEmail in displayTriageTool. If no one is mentioned, leave those fields blank.

### Resolving the cycle
ALWAYS call list-linear-cycles (no filter, so active + upcoming cycles come back). Then:
1. If the user mentioned a deadline — explicit ("entrega 20 abril", "for April 20", "due next Friday") or implicit (a date-like phrase) — parse it into ISO (YYYY-MM-DD) and put it in dueDate. Pick the cycle whose startsAt <= dueDate <= endsAt.
2. If dueDate falls AFTER the last known cycle's endsAt (too far out), use the currently-active cycle (isActive: true) and keep dueDate as-is so the card still shows it.
3. If dueDate falls BEFORE the first known cycle's startsAt (already past), use the active cycle.
4. If the user did NOT mention any deadline, leave dueDate blank and use the active cycle.
5. Always include cycleId and cycleName in displayTriageTool. Include dueDate only when the user provided one.

Today's date for resolving relative phrases like "next Friday": use the current date at the time of the triage.

## When the user says "create", "hazlo", "confirmed", etc.
They want to create the ticket. Respond: "Click the **Create Ticket** button on the card to start the workflow."
The button triggers the full pipeline (Linear issue → email → Slack → wait for resolution) automatically.

## Workflow Status Updates
When the workflow reports progress back to this chat (issue created, email sent, waiting for resolution), you will see those updates as system context. Acknowledge them naturally:
- Issue created → "Done! Issue [ID] created. [link]"
- Email sent → "Notification sent to [email]."
- Waiting → "Workflow paused — waiting for the assignee to resolve the issue."
- Resolved → "Issue resolved! Check your email for the resolution summary."

## Style
- Concise, technical, actionable. No fluff.
- Always use displayTriageTool/displayDuplicateTool for visual output — never repeat card data as text.
- For non-triage questions, respond in plain text.
- Respond in the same language the user writes in.`;

// Per-request project lookup — cheap single-row SELECT against the shared
// LibSQL container. Runs at instruction-render time, which is once per agent
// invocation. Keeping this inline (instead of a cached helper) so stale data
// can't leak across project switches inside the same process.
async function resolveProjectContext(projectId: string | null | undefined) {
  if (!projectId) return null;
  try {
    const db = createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
    const r = await db.execute({
      sql: 'SELECT id, name, status, documents_count, chunks_count FROM projects WHERE id = ? LIMIT 1',
      args: [projectId],
    });
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      status: String(row.status),
      documentsCount: Number(row.documents_count ?? 0),
      chunksCount: Number(row.chunks_count ?? 0),
    };
  } catch (err) {
    console.warn('[orchestrator] project context lookup failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Orchestrator agent — the main entry point for all user interactions.
 *
 * Routes to sub-agents (triage, resolution-reviewer) internally via tools,
 * and handles direct conversation with the user. Uses Mercury for fast
 * text generation and reasoning.
 *
 * The frontend connects to this agent at:
 *   POST /api/agents/orchestrator/stream
 */
export const orchestrator = new Agent({
  id: 'orchestrator',
  name: 'orchestrator',
  instructions: async ({ requestContext }) => {
    const projectId = requestContext?.get('projectId') as string | undefined;
    const project = await resolveProjectContext(projectId);

    if (!project) {
      return `${BASE_INSTRUCTIONS}

## Active Project
No project is currently selected. If the user asks about a codebase, tell them to select or create one at /projects.`;
    }

    const wikiReady = project.status === 'ready' && project.chunksCount > 0;
    const wikiGuidance = wikiReady
      ? `A codebase wiki is indexed for this project (${project.documentsCount} files, ${project.chunksCount} chunks). For ANY question about the codebase — what the project does, how features work, where specific code lives, what to reference during triage — call queryWikiTool with projectId="${project.id}" BEFORE answering from general knowledge. If the results don't cover the question, say so and answer from general knowledge.`
      : `The wiki for this project is "${project.status}" (no chunks indexed yet). Don't call queryWikiTool; answer from general knowledge and tell the user the wiki isn't ready if they ask codebase-specific questions.`;

    return `${BASE_INSTRUCTIONS}

## Active Project
name="${project.name}" id="${project.id}" status="${project.status}"

${wikiGuidance}`;
  },
  memory: new Memory({
    storage: memoryStorage,
    options: {
      lastMessages: 40,
      semanticRecall: false,
      generateTitle: true,
    },
  }),
  // Mercury-2 stays primary (fast text, cheap). include_reasoning was
  // making OpenRouter reserve the model's full 50k-token output capacity,
  // which triggered spurious 402s on keys with lower balances. Dropped it —
  // mercury-2 is a text-only model, reasoning tokens don't help classification.
  // max_tokens bumped to 4000 to leave room for tool-call JSON payloads.
  model: async ({ requestContext }) => {
    const openrouter = await resolveOpenRouterFromContext({ requestContext });
    return openrouter(MODELS.mercury, {
      extraBody: {
        models: [MODELS.mercury, MODELS.orchestratorFallback1],
        route: 'fallback',
        max_tokens: 4000,
      },
    });
  },
  tools: {
    getLinearIssueTool,
    listLinearIssuesTool,
    getTeamMembersTool,
    listLinearCyclesTool,
    queryWikiTool,
    generateWikiTool,
    processAttachmentsTool,
    displayTriageTool,
    displayDuplicateTool,
  },
});
