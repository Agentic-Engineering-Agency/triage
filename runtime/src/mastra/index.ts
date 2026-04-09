import { Mastra } from '@mastra/core';
import { registerApiRoute } from '@mastra/core/server';
import { LibSQLStore } from '@mastra/libsql';
import { chatRoute } from '@mastra/ai-sdk';
import { LinearClient } from '@linear/sdk';
import type { Context } from 'hono';

import { orchestrator, triageAgent, resolutionReviewer, codeReviewAgent } from './agents/index';
import { triageWorkflow } from './workflows/index';
import { auth } from '../lib/auth';
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
      registerApiRoute('/auth/*', {
        method: 'ALL',
        handler: async (c) => {
          return auth.handler(c.req.raw);
        },
      }),

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
              let projectName: string | null = null;
              try {
                const proj = await issue.project;
                if (proj) projectName = proj.name;
              } catch { /* project may not exist */ }

              grouped[stateName].push({
                id: issue.id,
                identifier: issue.identifier,
                title: issue.title,
                priority: issue.priority,
                estimate: issue.estimate ?? null,
                project: projectName,
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

      // GET /api/linear/cycle/active — current active cycle with progress
      {
        path: '/api/linear/cycle/active',
        method: 'GET' as const,
        handler: async (c: Context) => {
          try {
            if (!linearClient) {
              return c.json({ success: false, error: { code: 'NO_LINEAR_KEY', message: 'LINEAR_API_KEY not configured' } }, 500);
            }

            const team = await linearClient.team(LINEAR_CONSTANTS.TEAM_ID);
            const cyclesConnection = await team.cycles({ filter: { isActive: { eq: true } }, first: 1 });
            const activeCycle = cyclesConnection.nodes[0];

            if (!activeCycle) {
              return c.json({ success: true, data: null });
            }

            return c.json({
              success: true,
              data: {
                id: activeCycle.id,
                name: activeCycle.name ?? `Cycle ${activeCycle.number}`,
                number: activeCycle.number,
                startsAt: activeCycle.startsAt?.toISOString?.() ?? String(activeCycle.startsAt ?? ''),
                endsAt: activeCycle.endsAt?.toISOString?.() ?? String(activeCycle.endsAt ?? ''),
                progress: activeCycle.progress ?? 0,
                scopeCount: (activeCycle as Record<string, unknown>).scopeCount ?? 0,
                completedScopeCount: (activeCycle as Record<string, unknown>).completedScopeCount ?? 0,
                startedScopeCount: (activeCycle as Record<string, unknown>).startedScopeCount ?? 0,
              },
            });
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

      // POST /api/linear/webhook/setup — register the Linear webhook for this deployment
      {
        path: '/api/linear/webhook/setup',
        method: 'POST' as const,
        handler: async (c: Context) => {
          try {
            if (!linearClient) {
              return c.json({ success: false, error: { code: 'NO_LINEAR_KEY', message: 'LINEAR_API_KEY not configured' } }, 500);
            }

            const body = await c.req.json() as { url?: string };
            if (!body.url) {
              return c.json({ success: false, error: { code: 'MISSING_URL', message: 'url is required' } }, 400);
            }

            const result = await linearClient.createWebhook({
              url: body.url,
              teamId: LINEAR_CONSTANTS.TEAM_ID,
              resourceTypes: ['Issue'],
              enabled: true,
            });

            const webhook = await result.webhook;
            return c.json({ success: true, data: { id: webhook?.id, url: webhook?.url, enabled: webhook?.enabled } });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return c.json({ success: false, error: { code: 'LINEAR_ERROR', message } }, 500);
          }
        },
      },

      // POST /api/webhooks/linear — resume suspended workflow when issue moves to Done
      {
        path: '/api/webhooks/linear',
        method: 'POST' as const,
        createHandler: async ({ mastra: m }: { mastra: Mastra }) => {
          return async (c: Context) => {
            try {
              const payload = await c.req.json() as Record<string, unknown>;
              console.log('[webhook/linear] Received:', JSON.stringify(payload).slice(0, 500));

              const action = payload.action as string;
              const type = payload.type as string;
              const data = payload.data as Record<string, unknown> | undefined;

              // Only handle issue updates
              if (action !== 'update' || type !== 'Issue' || !data) {
                return c.json({ success: true, data: { received: true, skipped: true } });
              }

              const issueId = data.id as string;
              const issueState = data.state as { name?: string; type?: string } | undefined;
              const updatedAt = (data.updatedAt as string) ?? new Date().toISOString();

              // Only trigger on completed state (Done)
              if (issueState?.type !== 'completed') {
                return c.json({ success: true, data: { received: true, skipped: true, reason: 'state not completed' } });
              }

              console.log(`[webhook/linear] Issue ${issueId} marked as "${issueState.name}" — searching for suspended run`);

              // Find the suspended workflow run for this issueId via storage
              const storage = m.getStorage();
              const workflowsStore = await storage?.getStore('workflows');

              if (!workflowsStore) {
                console.error('[webhook/linear] Workflow storage not available');
                return c.json({ success: false, error: { code: 'NO_STORAGE', message: 'Workflow storage not available' } }, 500);
              }

              const runsResult = await workflowsStore.listWorkflowRuns({
                workflowName: 'triage-workflow',
                status: 'suspended',
                perPage: false,
              });

              // Match by issueId stored in the ticket step output inside the snapshot
              let matchedRunId: string | null = null;
              for (const run of runsResult.runs) {
                const snapshot = typeof run.snapshot === 'string'
                  ? JSON.parse(run.snapshot) as Record<string, unknown>
                  : run.snapshot as unknown as Record<string, unknown>;

                const context = snapshot?.context as Record<string, Record<string, unknown>> | undefined;
                const ticketOutput = context?.['ticket']?.['output'] as Record<string, unknown> | undefined;

                if (ticketOutput?.['issueId'] === issueId) {
                  matchedRunId = run.runId;
                  break;
                }
              }

              if (!matchedRunId) {
                console.log(`[webhook/linear] No suspended run found for issueId: ${issueId}`);
                return c.json({ success: true, data: { received: true, matched: false } });
              }

              console.log(`[webhook/linear] Resuming run ${matchedRunId} for issue ${issueId}`);

              // Resume the suspended step — fire and forget so webhook responds immediately
              const workflow = m.getWorkflow('triage-workflow');
              const workflowRun = await workflow.createRun({ runId: matchedRunId });

              workflowRun.resume({
                step: 'suspend',
                resumeData: {
                  newStatus: issueState.name ?? 'Done',
                  updatedAt,
                },
              }).catch((err: Error) => {
                console.error('[webhook/linear] Resume error:', err.message);
              });

              return c.json({ success: true, data: { received: true, matched: true, runId: matchedRunId } });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return c.json({ success: false, error: { code: 'WEBHOOK_ERROR', message } }, 500);
            }
          };
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
