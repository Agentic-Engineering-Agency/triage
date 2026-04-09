import { Mastra } from '@mastra/core';
import { registerApiRoute } from '@mastra/core/server';
import { LibSQLStore } from '@mastra/libsql';
import { chatRoute } from '@mastra/ai-sdk';

import { orchestrator, triageAgent, resolutionReviewer, codeReviewAgent } from './agents/index';
import { triageWorkflow } from './workflows/index';
import { auth } from '../auth/index';

export const mastra = new Mastra({
  agents: {
    orchestrator,
    'triage-agent': triageAgent,
    'resolution-reviewer': resolutionReviewer,
    'code-review-agent': codeReviewAgent,
  },
  workflows: {
    'triage-workflow': triageWorkflow,
  },
  storage: new LibSQLStore({
    id: 'triage-main',
    url: process.env.LIBSQL_URL || 'http://libsql:8080',
  }),
  server: {
    apiRoutes: [
      chatRoute({ path: '/chat', agent: 'orchestrator' }),
      registerApiRoute('/auth/*', {
        method: 'ALL',
        handler: async (c) => {
          return auth.handler(c.req.raw);
        },
      }),
    ],
  },
});
