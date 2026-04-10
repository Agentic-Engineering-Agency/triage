import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { MODELS, MODEL_CHAINS, LINEAR_BASE_URL, LINEAR_CONSTANTS } from '../../lib/config';

// Explicit storage for memory — ensures persistence to the shared LibSQL container
const memoryStorage = new LibSQLStore({
  id: 'memory-store',
  url: process.env.LIBSQL_URL || 'http://libsql:8080',
});
import { codeReviewAgent } from './code-review-agent';
import {
  createLinearIssueTool,
  updateLinearIssueTool,
  getLinearIssueTool,
  listLinearIssuesTool,
  getTeamMembersTool,
  listLinearCyclesTool,
  sendTicketEmailTool,
  sendResolutionEmailTool,
  sendSlackTicketNotificationTool,
  sendSlackResolutionNotificationTool,
  sendSlackMessageTool,
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
  instructions: `You are Triage, an SRE incident triage assistant for e-commerce platforms (Solidus/Rails stack).

## Core Logic
1. **Attachments First**: If files are attached, call process-attachments immediately to extract content.
2. **Context & Duplicates**: Query the wiki for relevant code context, then check for existing similar tickets using list-linear-issues. Estimate similarity by keyword overlap.
3. **Present Triage Card**: If no high-similarity duplicates found, call displayTriage to show the preview. The card IS the visual preview — do NOT repeat details as text.
4. **Await Confirmation**: When user approves or after receiving "confirmed", call create-linear-issue. For changes, update the triage card and call displayTriage again.

## Response Style
- Be concise, technical, actionable
- Reference specific files and line ranges when possible
- Use displayTriage for previews (not text repetition), displayDuplicate for similar tickets
- When answering questions (no triage card), respond in plain text

## Tool Reference
- Use tools from conversation memory: team members, labels, states are available in context
- NEVER ask users for IDs — all are configured in memory
- Delegate code review to code-review-agent
- Send notifications after ticket creation: email + Slack for visibility`,
  memory: new Memory({
    storage: memoryStorage,
    options: {
      lastMessages: 40,
      semanticRecall: false,
      generateTitle: true,
    },
  }),
  model: openrouter(MODELS.orchestrator, {
    extraBody: {
      models: MODEL_CHAINS.orchestrator,
      route: 'fallback',
      max_tokens: 4096,
      include_reasoning: true,
    },
  }),
  agents: {
    codeReviewAgent,
  },
  tools: {
    createLinearIssueTool,
    updateLinearIssueTool,
    getLinearIssueTool,
    listLinearIssuesTool,
    getTeamMembersTool,
    listLinearCyclesTool,
    sendTicketEmailTool,
    sendResolutionEmailTool,
    sendSlackTicketNotificationTool,
    sendSlackResolutionNotificationTool,
    sendSlackMessageTool,
    queryWikiTool,
    generateWikiTool,
    processAttachmentsTool,
    displayTriageTool,
    displayDuplicateTool,
  },
});
