import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { chatRoute } from '@mastra/ai-sdk';
import { LinearClient } from '@linear/sdk';
import type { Context } from 'hono';

import { orchestrator, triageAgent, resolutionReviewer, codeReviewAgent } from './agents/index';
import { triageWorkflow } from './workflows/index';
import { config, LINEAR_CONSTANTS } from '../lib/config';

// Linear client singleton — only instantiate if API key is configured
const linearClient = config.LINEAR_API_KEY ? new LinearClient({ apiKey: config.LINEAR_API_KEY }) : null;

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

      // GET /api/linear/issues — fetch and group by state
      {
        path: '/api/linear/issues',
        method: 'GET' as const,
        handler: async (c: Context) => {
          try {
            if (!linearClient) {
              return c.json({ success: false, error: { code: 'NO_LINEAR_KEY', message: 'LINEAR_API_KEY not configured' } }, 500);
            }

            const issues = await linearClient.issues({
              filter: { team: { id: { eq: LINEAR_CONSTANTS.TEAM_ID } } },
              first: 50,
            });

            const grouped: Record<string, Array<Record<string, unknown>>> = {};
            for (const issue of issues.nodes) {
              const state = await issue.state;
              const stateName = state?.name ?? 'Unknown';
              if (!grouped[stateName]) grouped[stateName] = [];

              const assigneeNode = await issue.assignee;
              const labelsConnection = await issue.labels();

              grouped[stateName].push({
                id: issue.id,
                identifier: issue.identifier,
                title: issue.title,
                priority: issue.priority,
                url: issue.url,
                createdAt: issue.createdAt?.toISOString?.() ?? String(issue.createdAt),
                updatedAt: issue.updatedAt?.toISOString?.() ?? String(issue.updatedAt),
                assignee: assigneeNode ? { id: assigneeNode.id, name: assigneeNode.name } : null,
                labels: labelsConnection.nodes.map((l: { id: string; name: string; color: string }) => ({ id: l.id, name: l.name, color: l.color })),
              });
            }

            return c.json({ success: true, data: grouped });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return c.json({ success: false, error: { code: 'LINEAR_ERROR', message } }, 500);
          }
        },
      },

      // GET /api/linear/members — list team members
      {
        path: '/api/linear/members',
        method: 'GET' as const,
        handler: async (c: Context) => {
          try {
            if (!linearClient) {
              return c.json({ success: false, error: { code: 'NO_LINEAR_KEY', message: 'LINEAR_API_KEY not configured' } }, 500);
            }

            const team = await linearClient.team(LINEAR_CONSTANTS.TEAM_ID);
            const members = await team.members();
            const data = members.nodes
              .filter((m: { guest: boolean; active: boolean }) => !m.guest && m.active)
              .map((m: { id: string; name: string; email: string; displayName: string }) => ({
                id: m.id,
                name: m.name,
                email: m.email,
                displayName: m.displayName,
              }));

            return c.json({ success: true, data: { members: data } });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return c.json({ success: false, error: { code: 'LINEAR_ERROR', message } }, 500);
          }
        },
      },

      // POST /api/wiki/generate — start wiki generation
      {
        path: '/api/wiki/generate',
        method: 'POST' as const,
        handler: async (c: Context) => {
          try {
            const body = await c.req.json() as { repoUrl?: string };
            if (!body.repoUrl) {
              return c.json({ success: false, error: { code: 'MISSING_REPO_URL', message: 'repoUrl is required' } }, 400);
            }
            // TODO: Implement full wiki generation (git clone, file walk, generateWikiTool calls)
            console.log(`[wiki/generate] Received request for repo: ${body.repoUrl}`);
            return c.json({ success: true, data: { status: 'started', repoUrl: body.repoUrl } });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return c.json({ success: false, error: { code: 'WIKI_ERROR', message } }, 500);
          }
        },
      },

      // GET /api/wiki/status — wiki generation status
      {
        path: '/api/wiki/status',
        method: 'GET' as const,
        handler: async (c: Context) => {
          return c.json({ success: true, data: { total: 0, processed: 0, done: true } });
        },
      },

      // POST /api/webhooks/linear — handle Linear webhooks to resume workflow
      {
        path: '/api/webhooks/linear',
        method: 'POST' as const,
        handler: async (c: Context) => {
          try {
            const payload = await c.req.json() as Record<string, unknown>;
            console.log('[webhook/linear] Received:', JSON.stringify(payload).slice(0, 500));

            const action = payload.action as string;
            const data = payload.data as Record<string, unknown> | undefined;

            if (action === 'update' && data) {
              const issueId = data.id as string;
              console.log(`[webhook/linear] Issue ${issueId} updated`);
              // TODO: Look up suspended workflow run by issueId and resume it
            }

            return c.json({ success: true, data: { received: true } });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return c.json({ success: false, error: { code: 'WEBHOOK_ERROR', message } }, 500);
          }
        },
      },

      // POST /api/workflows/triage-workflow/trigger — trigger the triage workflow
      {
        path: '/api/workflows/triage-workflow/trigger',
        method: 'POST' as const,
        createHandler: async ({ mastra: m }: { mastra: Mastra }) => {
          return async (c: Context) => {
            try {
              const body = await c.req.json() as Record<string, unknown>;
              const workflow = m.getWorkflow('triage-workflow');
              const run = await workflow.createRun();

              // Start the workflow in the background
              run.start({ inputData: body }).catch((err: Error) => {
                console.error('[workflow/trigger] Error:', err.message);
              });

              return c.json({ success: true, data: { runId: run.runId, status: 'started' } });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return c.json({ success: false, error: { code: 'WORKFLOW_ERROR', message } }, 500);
            }
          };
        },
      },
    ],
  },
});
