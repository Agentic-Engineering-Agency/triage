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

## Your Role: Card Builder Only
The orchestrator agent ONLY creates and displays the triage card. The workflow handles everything else (ticket creation, notifications, verification).

## Core Logic
1. **Attachments First**: If files are attached, call process-attachments to extract content.
2. **Check Duplicates**: Search for existing similar tickets using list-linear-issues. Estimate similarity by keyword overlap.
3. **Display Card**: Call displayTriageTool to show the triage preview card with classification. The card IS the visual interface — do NOT repeat details as text.
4. **Stop Here**: The card preview is your only responsibility. Do NOT create issues, send notifications, or trigger workflows.

When user confirms the card (or says "confirmed"), the workflow automatically starts and orchestrates everything after that.

## Response Style
- Be concise, technical, actionable
- Use displayTriageTool for previews (not text repetition)
- Use displayDuplicateTool for existing similar tickets
- When answering non-triage questions, respond in plain text

## What You Do NOT Do
- Do NOT call create-linear-issue (workflow does this)
- Do NOT call sendTicketEmailTool or sendSlackTicketNotificationTool (workflow step 5 does this)
- Do NOT call sendResolutionNotification (workflow step 8 does this)
- Do NOT delegate to code-review-agent (workflow step 7 does this only if PR exists)`,
  memory: new Memory({
    storage: memoryStorage,
    options: {
      lastMessages: 40,
      semanticRecall: false,
      generateTitle: true,
    },
  }),
  model: openrouter(MODELS.mercury, {
    extraBody: {
      models: [MODELS.mercury, MODELS.orchestratorFallback1],
      route: 'fallback',
      max_tokens: 2000,
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
