import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';

import { env } from '../lib/config';
import { orchestrator, triageAgent, resolutionReviewer, codeReviewAgent } from './agents/index';

/**
 * Mastra instance — the core runtime for the Triage SRE agent.
 *
 * Registered for the runtime scaffold phase:
 * - 4 agents: orchestrator (main), triage-agent, resolution-reviewer, code-review-agent
 * - LibSQL storage for thread/memory state
 *
 * Note: workflows are scaffolded on disk but intentionally NOT registered until
 * the downstream integrations (Linear, wiki, email) are implemented. This avoids
 * exposing placeholder workflow steps that would fabricate successful state.
 */
export const mastra = new Mastra({
  agents: {
    orchestrator,
    'triage-agent': triageAgent,
    'resolution-reviewer': resolutionReviewer,
    'code-review-agent': codeReviewAgent,
  },
  storage: new LibSQLStore({
    id: 'triage-main',
    url: env.LIBSQL_URL,
  }),
});
