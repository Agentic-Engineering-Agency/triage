import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { MODELS } from '../../lib/config';

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

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

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
  instructions: `You are Triage, an SRE incident triage assistant.

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
- Respond in the same language the user writes in.`,
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
  model: openrouter(MODELS.mercury, {
    extraBody: {
      models: [MODELS.mercury, MODELS.orchestratorFallback1],
      route: 'fallback',
      max_tokens: 4000,
    },
  }),
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
