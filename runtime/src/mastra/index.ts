import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';

import { orchestrator, triageAgent, resolutionReviewer } from './agents/index';
import { triageWorkflow } from './workflows/index';

/**
 * Mastra instance — the core runtime for the Triage SRE agent.
 *
 * Registers:
 * - 3 agents: orchestrator (main), triage-agent (analysis), resolution-reviewer (verification)
 * - 1 workflow: triageWorkflow (full E2E intake → resolve pipeline)
 * - LibSQL storage for workflow state, threads, and memory
 *
 * HTTP endpoints exposed by mastra.serve():
 * - POST /api/agents/:agentId/stream    — SSE chat streaming
 * - POST /api/agents/:agentId/generate  — one-shot generation
 * - GET  /health                        — health check
 *
 * The frontend connects to: POST /api/agents/orchestrator/stream
 */
export const mastra = new Mastra({
  agents: {
    orchestrator,
    'triage-agent': triageAgent,
    'resolution-reviewer': resolutionReviewer,
  },
  workflows: {
    'triage-workflow': triageWorkflow,
  },
  storage: new LibSQLStore({
    id: 'triage-main',
    url: process.env.LIBSQL_URL || 'http://libsql:8080',
  }),
});
