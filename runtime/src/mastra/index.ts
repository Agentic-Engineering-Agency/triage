import { Mastra } from '@mastra/core';
import { registerApiRoute } from '@mastra/core/server';
import { LibSQLStore } from '@mastra/libsql';
import { chatRoute } from '@mastra/ai-sdk';
import { LinearClient } from '@linear/sdk';
import type { Context } from 'hono';

import { orchestrator, triageAgent, resolutionReviewer, codeReviewAgent, slackNotificationAgent } from './agents/index';
import { triageWorkflow } from './workflows/index';
import { sendSlackMessage } from './tools/slack';
import { auth } from '../lib/auth';
import { projectRoutes } from '../lib/project-routes';
import { webhookRoutes } from '../lib/webhook-routes';
import { integrationRoutes } from '../lib/integration-routes';
import { scopedRoutes } from '../lib/scoped-routes';
import { observabilityRoutes } from '../lib/observability-routes';
import { config, LINEAR_CONSTANTS } from '../lib/config';
import { getMemoryInitializationContext } from '../lib/memory-context-init';
import { syncLinearIssues, getCachedIssues, getLastSyncedAt, isSyncInProgress, initLinearSync } from '../lib/linear-sync';

// Linear client singleton — only instantiate if API key is configured
const linearClient = config.LINEAR_API_KEY ? new LinearClient({ apiKey: config.LINEAR_API_KEY }) : null;

export const mastra = new Mastra({
  agents: {
    orchestrator,
    'triage-agent': triageAgent,
    'resolution-reviewer': resolutionReviewer,
    'code-review-agent': codeReviewAgent,
    'slack-notification-agent': slackNotificationAgent,
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
      chatRoute({ path: '/chat', agent: 'orchestrator', sendReasoning: true, defaultOptions: { savePerStep: true } }),
      registerApiRoute('/auth/*', {
        method: 'ALL',
        handler: async (c) => {
          return auth.handler(c.req.raw);
        },
      }),

      // GET /api/linear/issues — serve from local cache (synced from Linear API)
      // Falls back to a live sync if cache is empty
      {
        path: '/api/linear/issues',
        method: 'GET' as const,
        handler: async (c: Context) => {
          try {
            if (!linearClient) {
              return c.json({ success: false, error: { code: 'NO_LINEAR_KEY', message: 'LINEAR_API_KEY not configured' } }, 500);
            }

            // Try reading from cache first
            let grouped = await getCachedIssues();

            // If cache is empty, trigger a sync and wait for it
            if (!grouped) {
              console.log('[api/linear/issues] Cache empty, triggering sync...');
              grouped = await syncLinearIssues();
            }

            return c.json({ success: true, data: grouped });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return c.json({ success: false, error: { code: 'LINEAR_ERROR', message } }, 500);
          }
        },
      },

      // POST /api/linear/sync — trigger a manual sync from Linear API
      {
        path: '/api/linear/sync',
        method: 'POST' as const,
        handler: async (c: Context) => {
          try {
            if (!linearClient) {
              return c.json({ success: false, error: { code: 'NO_LINEAR_KEY', message: 'LINEAR_API_KEY not configured' } }, 500);
            }

            const grouped = await syncLinearIssues();
            const totalIssues = Object.values(grouped).flat().length;

            return c.json({
              success: true,
              data: {
                issueCount: totalIssues,
                syncedAt: getLastSyncedAt()?.toISOString() ?? null,
              },
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return c.json({ success: false, error: { code: 'LINEAR_ERROR', message } }, 500);
          }
        },
      },

      // GET /api/linear/sync/status — check when data was last synced
      {
        path: '/api/linear/sync/status',
        method: 'GET' as const,
        handler: async (c: Context) => {
          return c.json({
            success: true,
            data: {
              lastSyncedAt: getLastSyncedAt()?.toISOString() ?? null,
              syncInProgress: isSyncInProgress(),
            },
          });
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

      // GET /api/config/status — check configuration status
      {
        path: '/api/config/status',
        method: 'GET' as const,
        handler: async (c: Context) => {
          return c.json({
            success: true,
            data: {
              linearConfigured: !!config.LINEAR_API_KEY,
              openrouterConfigured: !!process.env.OPENROUTER_API_KEY,
            },
          });
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

      // POST /api/wiki/generate — start wiki generation via wiki-rag pipeline
      {
        path: '/api/wiki/generate',
        method: 'POST' as const,
        handler: async (c: Context) => {
          try {
            const body = await c.req.json() as { repoUrl?: string };
            if (!body.repoUrl) {
              return c.json({ success: false, error: { code: 'MISSING_REPO_URL', message: 'repoUrl is required' } }, 400);
            }

            const { generateWiki } = await import('../lib/wiki-rag');
            const { createClient } = await import('@libsql/client');
            const crypto = await import('crypto');

            const db = createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
            const projectId = crypto.randomUUID();
            const now = Date.now();

            // Create project record
            await db.execute({
              sql: `INSERT INTO projects (id, name, repository_url, branch, status, created_at, updated_at) VALUES (?, ?, ?, 'main', 'processing', ?, ?)`,
              args: [projectId, body.repoUrl.split('/').pop() || 'repo', body.repoUrl, now, now],
            });

            console.log(`[wiki/generate] Starting wiki generation for: ${body.repoUrl} (project: ${projectId})`);

            // Run in background (non-blocking)
            generateWiki(projectId, body.repoUrl).catch((err: Error) => {
              console.error(`[wiki/generate] Pipeline error: ${err.message}`);
            });

            return c.json({ success: true, data: { status: 'processing', repoUrl: body.repoUrl, projectId } });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return c.json({ success: false, error: { code: 'WIKI_ERROR', message } }, 500);
          }
        },
      },

      // GET /api/wiki/status — wiki generation status (reads from projects table + counts from wiki_* tables)
      {
        path: '/api/wiki/status',
        method: 'GET' as const,
        handler: async (c: Context) => {
          try {
            const { createClient } = await import('@libsql/client');
            const db = createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });

            // Get the latest project
            const projectResult = await db.execute('SELECT id, status, error FROM projects ORDER BY created_at DESC LIMIT 1');
            const project = projectResult.rows[0];
            if (!project) {
              return c.json({ success: true, data: { total: 0, processed: 0, done: true, status: 'idle' } });
            }

            // Count actual documents and chunks from the tables
            const docsResult = await db.execute('SELECT COUNT(*) as count FROM wiki_documents WHERE project_id = ?', [project.id as string]);
            const chunksResult = await db.execute('SELECT COUNT(*) as count FROM wiki_chunks WHERE document_id IN (SELECT id FROM wiki_documents WHERE project_id = ?)', [project.id as string]);

            const docCount = Number(docsResult.rows[0]?.count ?? 0);
            const chunkCount = Number(chunksResult.rows[0]?.count ?? 0);
            const done = project.status === 'ready' || project.status === 'error';

            return c.json({
              success: true,
              data: {
                total: docCount + chunkCount,
                processed: chunkCount, // chunks are the actual embeddings created
                done,
                status: project.status,
                error: project.error || undefined,
                documents: docCount,
                chunks: chunkCount,
              },
            });
          } catch (err) {
            console.error('[wiki/status] Error:', err instanceof Error ? err.message : 'unknown');
            return c.json({ success: true, data: { total: 0, processed: 0, done: false, status: 'error' } });
          }
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

              if (action !== 'update' || type !== 'Issue' || !data) {
                return c.json({ success: true, data: { received: true, skipped: true } });
              }

              const issueId = data.id as string;
              const issueState = data.state as { name?: string; type?: string } | undefined;
              const updatedAt = (data.updatedAt as string) ?? new Date().toISOString();

              if (issueState?.type !== 'completed') {
                return c.json({ success: true, data: { received: true, skipped: true, reason: 'state not completed' } });
              }

              console.log(`[webhook/linear] Issue ${issueId} marked as "${issueState.name}" — searching for suspended run`);

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
              const workflow = m.getWorkflow('triage-workflow');
              const workflowRun = await workflow.createRun({ runId: matchedRunId });

              // Resume in background — after completion, save resolution message to the chat thread
              workflowRun.resume({
                step: 'suspend',
                resumeData: { newStatus: issueState.name ?? 'Done', updatedAt },
              }).then(async () => {
                console.log(`[webhook/linear] Workflow resumed and completed for run ${matchedRunId}`);
                // Look up the threadId from workflow_runs table
                const dbClient = (await import('@libsql/client')).createClient({
                  url: process.env.LIBSQL_URL || 'http://libsql:8080',
                });
                const row = await dbClient.execute({
                  sql: `SELECT thread_id, issue_url FROM workflow_runs WHERE run_id = ?`,
                  args: [matchedRunId],
                });
                const threadId = row.rows[0]?.thread_id as string | undefined;
                const issueUrl = (row.rows[0]?.issue_url as string) || '';
                if (threadId) {
                  const viewLink = issueUrl ? ` — [View in Linear](${issueUrl})` : '';
                  const resolutionMsg = `\u2705 Issue resolved! The assignee marked it as "${issueState.name ?? 'Done'}". Resolution notifications have been sent. Check your email for details.${viewLink}`;
                  // Save to the conversation thread
                  const messagesStore = (await m.getStorage()?.getStore('messages')) as unknown as { add: (msg: Record<string, unknown>) => Promise<void> } | undefined;
                  if (messagesStore?.add) {
                    await messagesStore.add({
                      id: `resolution-${Date.now()}`,
                      threadId,
                      role: 'assistant',
                      content: { parts: [{ type: 'text', text: resolutionMsg }] },
                      createdAt: new Date().toISOString(),
                    });
                  }
                  // Update run status
                  await dbClient.execute({
                    sql: `UPDATE workflow_runs SET status = 'completed' WHERE run_id = ?`,
                    args: [matchedRunId],
                  });
                  console.log(`[webhook/linear] Resolution message saved to thread ${threadId}`);
                }
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

      // POST /api/workflows/triage-workflow/trigger — manually trigger a workflow run
      {
        path: '/api/workflows/triage-workflow/trigger',
        method: 'POST' as const,
        createHandler: async ({ mastra: m }: { mastra: Mastra }) => {
          return async (c: Context) => {
            try {
              const body = await c.req.json() as Record<string, unknown>;
              const workflow = m.getWorkflow('triage-workflow');
              const run = await workflow.createRun();

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

      // POST /api/workflows/triage-workflow/stream — run workflow with SSE progress streaming
      {
        path: '/api/workflows/triage-workflow/stream',
        method: 'POST' as const,
        createHandler: async ({ mastra: m }: { mastra: Mastra }) => {
          return async (c: Context) => {
            // SSE headers
            c.header('Content-Type', 'text/event-stream');
            c.header('Cache-Control', 'no-cache');
            c.header('Connection', 'keep-alive');

            const body = await c.req.json() as Record<string, unknown>;
            const threadId = body.threadId as string | undefined;

            // Helper to format an SSE message
            const sseMessage = (data: Record<string, unknown>) =>
              `data: ${JSON.stringify(data)}\n\n`;

            return c.body(
              new ReadableStream({
                async start(controller) {
                  const encoder = new TextEncoder();
                  const send = (data: Record<string, unknown>) => {
                    try { controller.enqueue(encoder.encode(sseMessage(data))); } catch { /* stream closed */ }
                  };

                  try {
                    const workflow = m.getWorkflow('triage-workflow');
                    const run = await workflow.createRun();

                    // Save runId → threadId mapping for webhook resolution notifications
                    if (threadId) {
                      const dbClient = (await import('@libsql/client')).createClient({
                        url: process.env.LIBSQL_URL || 'http://libsql:8080',
                      });
                      await dbClient.execute({
                        sql: `INSERT OR REPLACE INTO workflow_runs (id, run_id, thread_id, status, created_at) VALUES (?, ?, ?, 'running', ?)`,
                        args: [run.runId, run.runId, threadId, Date.now()],
                      }).catch((err: Error) => console.error('[workflow/stream] Failed to save run mapping:', err.message));
                    }

                    send({ step: 'intake', status: 'running', message: 'Analyzing incident...' });

                    // Run the workflow — this promise resolves when it completes or suspends
                    const result = await run.start({ inputData: body });

                    // Read workflow snapshot to extract per-step results
                    const snapshot = (result as Record<string, unknown>)?.snapshot
                      ?? (run as unknown as Record<string, unknown>).snapshot;
                    const snapshotObj = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
                    const ctx = (snapshotObj as Record<string, unknown>)?.context as Record<string, Record<string, unknown>> | undefined;

                    // Ordered steps to report
                    const stepDefs = [
                      { id: 'intake', label: 'Analyzing incident...' },
                      { id: 'triage', label: 'Classifying severity and root cause...' },
                      { id: 'dedup', label: 'Checking for duplicates...' },
                      { id: 'ticket', label: 'Creating Linear ticket...' },
                      { id: 'notify', label: 'Sending notifications...' },
                      { id: 'suspend', label: 'Waiting for assignee to resolve the issue...' },
                    ];

                    for (const def of stepDefs) {
                      const stepCtx = ctx?.[def.id];
                      const output = stepCtx?.output as Record<string, unknown> | undefined;
                      const error = stepCtx?.error as string | undefined;

                      if (error) {
                        send({ step: def.id, status: 'error', message: error });
                        break;
                      }

                      if (def.id === 'suspend') {
                        // Suspend step — workflow paused here
                        const ticketOutput = ctx?.['ticket']?.output as Record<string, unknown> | undefined;
                        send({
                          step: 'suspend',
                          status: 'suspended',
                          message: def.label,
                          data: {
                            issueId: ticketOutput?.issueId,
                            issueUrl: ticketOutput?.issueUrl,
                          },
                        });
                        break;
                      }

                      if (output) {
                        if (def.id === 'ticket') {
                          // Emit ticket step with key fields only
                          send({
                            step: 'ticket',
                            status: 'completed',
                            message: `Issue created: ${output.issueId ?? 'N/A'}`,
                            data: { issueId: output.issueId, issueUrl: output.issueUrl, wasUpdated: output.wasUpdated },
                          });
                          // Update workflow_runs with issueId for webhook resolution lookup
                          if (threadId && output.issueId) {
                            const dbClient2 = (await import('@libsql/client')).createClient({
                              url: process.env.LIBSQL_URL || 'http://libsql:8080',
                            });
                            dbClient2.execute({
                              sql: `UPDATE workflow_runs SET issue_id = ?, issue_url = ?, status = 'suspended' WHERE run_id = ?`,
                              args: [output.issueId as string, (output.issueUrl as string) ?? '', run.runId],
                            }).catch((err: Error) => console.error('[workflow/stream] Failed to update run mapping:', err.message));
                          }
                        } else if (def.id === 'notify') {
                          // Emit separate events for email and slack notifications
                          send({ step: def.id, status: 'completed', message: def.label, data: output });
                          if (output.notificationSent) {
                            const reporterEmail = output.reporterEmail as string | undefined;
                            if (reporterEmail) {
                              send({ step: 'notify-email', status: 'completed', message: `Email sent to ${reporterEmail}` });
                            }
                            send({ step: 'notify-slack', status: 'completed', message: 'Slack notification sent' });
                          }
                        } else {
                          send({ step: def.id, status: 'completed', message: def.label, data: output });
                        }
                      }
                    }

                    send({ step: 'done', status: 'done', message: 'Workflow stream complete' });
                  } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.error('[workflow/stream] Error:', message);
                    send({ step: 'error', status: 'error', message });
                  } finally {
                    try { controller.close(); } catch { /* already closed */ }
                  }
                },
              }),
            );
          };
        },
      },

      // POST /api/memory/init/:threadId — initialize thread memory with LINEAR_CONSTANTS context
      {
        path: '/api/memory/init/:threadId',
        method: 'POST' as const,
        createHandler: async ({ mastra: m }: { mastra: Mastra }) => {
          return async (c: Context) => {
            try {
              const threadId = c.req.param('threadId');

              if (!threadId) {
                return c.json({ success: false, error: { code: 'MISSING_THREAD_ID', message: 'threadId is required' } }, 400);
              }

              const storage = m.getStorage();
              const messagesStore = await storage?.getStore('messages');

              if (!messagesStore) {
                console.error('[memory] Messages store not available');
                return c.json({ success: false, error: { code: 'NO_STORAGE', message: 'Memory storage not available' } }, 500);
              }

              // Add LINEAR_CONSTANTS context as a system message (not counted in conversation)
              const contextMessage = getMemoryInitializationContext();

              // Store as a special system context message in memory
              await messagesStore.add(threadId, {
                role: 'system',
                content: contextMessage,
                timestamp: new Date().toISOString(),
              } as unknown as Record<string, unknown>);

              console.log(`[memory/init] Initialized context for thread ${threadId}`);

              return c.json({ success: true, data: { initialized: true, threadId } });
            } catch (error) {
              console.error('[memory/init] Error:', error instanceof Error ? error.message : String(error));
              return c.json({ success: false, error: { code: 'INIT_ERROR', message: 'Failed to initialize memory' } }, 500);
            }
          };
        },
      },

      // GET /memory/threads/:threadId/messages — fetch conversation history
      {
        path: '/memory/threads/:threadId/messages',
        method: 'GET' as const,
        createHandler: async ({ mastra: m }: { mastra: Mastra }) => {
          return async (c: Context) => {
            try {
              const threadId = c.req.param('threadId');
              const agentId = c.req.query('agentId') || 'orchestrator';

              if (!threadId) {
                return c.json({ success: false, error: { code: 'MISSING_THREAD_ID', message: 'threadId is required' } }, 400);
              }

              const storage = m.getStorage();
              const messagesStore = await storage?.getStore('messages');

              if (!messagesStore) {
                console.error('[memory] Messages store not available');
                return c.json({ messages: [] });
              }

              // Fetch messages for this thread — Mastra memory stores by threadId + agentId
              const messages = await messagesStore.list(threadId) as Array<Record<string, unknown>>;

              return c.json({ messages: messages || [] });
            } catch (error) {
              console.error('[memory] Error fetching messages:', error instanceof Error ? error.message : String(error));
              return c.json({ messages: [] });
            }
          };
        },
      },

      // POST /api/memory/save-message — persist an arbitrary message to a conversation thread
      {
        path: '/api/memory/save-message',
        method: 'POST' as const,
        createHandler: async ({ mastra: m }: { mastra: Mastra }) => {
          return async (c: Context) => {
            try {
              const body = await c.req.json() as { threadId?: string; role?: string; content?: string };

              if (!body.threadId || !body.content) {
                return c.json({ success: false, error: { code: 'MISSING_FIELDS', message: 'threadId and content are required' } }, 400);
              }

              const storage = m.getStorage();
              const messagesStore = await storage?.getStore('messages');

              if (!messagesStore) {
                return c.json({ success: false, error: { code: 'NO_STORAGE', message: 'Memory storage not available' } }, 500);
              }

              await messagesStore.add(body.threadId, {
                role: body.role ?? 'assistant',
                content: body.content,
                timestamp: new Date().toISOString(),
              } as unknown as Record<string, unknown>);

              return c.json({ success: true, data: { saved: true } });
            } catch (error) {
              console.error('[memory/save-message] Error:', error instanceof Error ? error.message : String(error));
              return c.json({ success: false, error: { code: 'SAVE_ERROR', message: 'Failed to save message' } }, 500);
            }
          };
        },
      },

      // POST /api/memory/card-state — persist triage card confirmed/error state
      {
        path: '/api/memory/card-state',
        method: 'POST' as const,
        handler: async (c: Context) => {
          try {
            const body = await c.req.json() as {
              threadId?: string;
              messageId?: string;
              toolIndex?: number;
              state?: string;
              linearUrl?: string;
            };

            if (!body.threadId || !body.messageId || body.toolIndex === undefined || !body.state) {
              return c.json({ success: false, error: { code: 'MISSING_FIELDS', message: 'threadId, messageId, toolIndex, and state are required' } }, 400);
            }

            const { createClient } = await import('@libsql/client');
            const db = createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });

            // Ensure card_states table exists (idempotent)
            await db.execute(`CREATE TABLE IF NOT EXISTS card_states (
              id TEXT PRIMARY KEY,
              thread_id TEXT NOT NULL,
              message_id TEXT NOT NULL,
              tool_index INTEGER NOT NULL,
              state TEXT NOT NULL DEFAULT 'confirmed',
              linear_url TEXT,
              created_at INTEGER NOT NULL
            )`);

            const id = `${body.threadId}-${body.messageId}-${body.toolIndex}`;
            await db.execute({
              sql: `INSERT OR REPLACE INTO card_states (id, thread_id, message_id, tool_index, state, linear_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              args: [id, body.threadId, body.messageId, body.toolIndex, body.state, body.linearUrl ?? null, Date.now()],
            });

            console.log(`[memory/card-state] Saved state=${body.state} for ${id}`);
            return c.json({ success: true, data: { saved: true } });
          } catch (error) {
            console.error('[memory/card-state] Error:', error instanceof Error ? error.message : String(error));
            return c.json({ success: false, error: { code: 'CARD_STATE_ERROR', message: 'Failed to save card state' } }, 500);
          }
        },
      },

      // GET /api/memory/card-states/:threadId — fetch persisted card states for a thread
      {
        path: '/api/memory/card-states/:threadId',
        method: 'GET' as const,
        handler: async (c: Context) => {
          try {
            const threadId = c.req.param('threadId');
            if (!threadId) {
              return c.json({ success: true, data: { cardStates: {} } });
            }

            const { createClient } = await import('@libsql/client');
            const db = createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });

            // Ensure table exists (in case it hasn't been created yet)
            await db.execute(`CREATE TABLE IF NOT EXISTS card_states (
              id TEXT PRIMARY KEY,
              thread_id TEXT NOT NULL,
              message_id TEXT NOT NULL,
              tool_index INTEGER NOT NULL,
              state TEXT NOT NULL DEFAULT 'confirmed',
              linear_url TEXT,
              created_at INTEGER NOT NULL
            )`);

            const result = await db.execute({
              sql: 'SELECT message_id, tool_index, state, linear_url FROM card_states WHERE thread_id = ?',
              args: [threadId],
            });

            const cardStates: Record<string, { state: string; linearUrl?: string }> = {};
            for (const row of result.rows) {
              const key = `${row.message_id}-${row.tool_index}`;
              cardStates[key] = {
                state: row.state as string,
                ...(row.linear_url ? { linearUrl: row.linear_url as string } : {}),
              };
            }

            return c.json({ success: true, data: { cardStates } });
          } catch (error) {
            console.error('[memory/card-states] Error:', error instanceof Error ? error.message : String(error));
            return c.json({ success: true, data: { cardStates: {} } });
          }
        },
      },

      // POST /api/test/slack — test Slack message sending
      {
        path: '/api/test/slack',
        method: 'POST' as const,
        handler: async (c: Context) => {
          try {
            const body = await c.req.json();
            const message = (body?.message as string) || '✅ Test message from triage-runtime';

            // Call sendSlackMessage using the correct input format
            const result = await sendSlackMessage.execute({
              text: message,
            }, {});

            return c.json({
              success: true,
              message: 'Slack message sent',
              result,
            });
          } catch (error) {
            console.error('[test/slack] Error:', error);
            return c.json({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, 500);
          }
        },
      },

      // POST /api/test/slack-agent — test Slack notification agent
      {
        path: '/api/test/slack-agent',
        method: 'POST' as const,
        handler: async (c: Context) => {
          try {
            const body = await c.req.json();
            const ticketData = body?.ticketData || {
              ticketTitle: 'Test Ticket — Slack Notification Agent',
              severity: 'High',
              summary: 'This is a test notification from the Slack notification agent.',
              linearUrl: 'https://linear.app/test',
              assigneeName: 'Ricardo',
              linearIssueId: 'TEST-001',
            };

            // Run the agent with ticket data
            const result = await slackNotificationAgent.generate(
              `Format and send this ticket notification to Slack: ${JSON.stringify(ticketData)}`
            );

            return c.json({
              success: true,
              message: 'Slack notification agent executed',
              result: result.text,
            });
          } catch (error) {
            console.error('[test/slack-agent] Error:', error);
            return c.json({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, 500);
          }
        },
      },

      // Project management, integrations, webhook, and scoped routes
      ...projectRoutes,
      ...integrationRoutes,
      ...scopedRoutes,
      ...webhookRoutes,
      ...observabilityRoutes,
    ],
  },
});

// Initialize Linear sync on startup (non-blocking)
initLinearSync();
