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
import { config, LINEAR_CONSTANTS, LINEAR_BASE_URL } from '../lib/config';
import { getMemoryInitializationContext } from '../lib/memory-context-init';
import { syncLinearIssues, getCachedIssues, getLastSyncedAt, isSyncInProgress, initLinearSync } from '../lib/linear-sync';
import { createClient } from '@libsql/client';
import { getLinearIssueComments, updateLinearIssue } from './tools/linear';
import { findGitHubEvidenceForIssueTool } from './tools/github';
import { sendTicketNotification, sendResolutionNotification } from './tools/resend';
import { sendSlackTicketNotification, sendSlackResolutionNotification } from './tools/slack';
import { logUsage } from '../lib/usage-logger';

// Paranoid anchored regex for parsing a repository URL. Bounded lengths,
// single-pass, no catastrophic backtracking.
const GITHUB_REPO_RE = /^https:\/\/github\.com\/([\w.-]{1,100})\/([\w.-]{1,100}?)(?:\.git)?\/?$/;
function parseGithubRepo(url: string | null | undefined): { owner: string; repo: string } | null {
  if (!url || typeof url !== 'string' || url.length > 300) return null;
  const m = url.match(GITHUB_REPO_RE);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

let warnedMissingGithubToken = false;

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
      // Track per-call llm usage for the orchestrator. Mastra calls onFinish
      // once per stream completion with the AI SDK event (usage, response,
      // runId). We intentionally skip threadId/projectId here because the
      // chatRoute helper doesn't surface request-body context inside onFinish
      // — populating those would require replacing chatRoute with a custom
      // handler. Aggregations by model/agent still work without them.
      chatRoute({
        path: '/chat',
        agent: 'orchestrator',
        sendReasoning: true,
        defaultOptions: {
          savePerStep: true,
          onFinish: (async (event: Record<string, unknown>) => {
            try {
              const usage = (event.usage ?? {}) as Record<string, unknown>;
              const response = (event.response ?? {}) as Record<string, unknown>;
              // AI SDK v4 uses promptTokens/completionTokens; v5 uses
              // inputTokens/outputTokens. Read both, prefer the v5 shape.
              const inputTokens = Number((usage.inputTokens as number | undefined) ?? (usage.promptTokens as number | undefined) ?? 0);
              const outputTokens = Number((usage.outputTokens as number | undefined) ?? (usage.completionTokens as number | undefined) ?? 0);
              const model = (response.modelId as string | undefined)
                ?? ((event.model as Record<string, unknown> | undefined)?.modelId as string | undefined)
                ?? 'unknown';
              await logUsage({
                agentId: 'orchestrator',
                model,
                inputTokens,
                outputTokens,
              });
            } catch (err) {
              console.error('[chat/onFinish] usage logging failed:', err instanceof Error ? err.message : err);
            }
          }) as never,
        },
      }),
      registerApiRoute('/health', {
        method: 'GET',
        handler: async (c) => c.json({ status: 'ok', service: 'triage-runtime' }),
      }),
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
                scopeCount: (activeCycle as unknown as Record<string, unknown>).scopeCount ?? 0,
                completedScopeCount: (activeCycle as unknown as Record<string, unknown>).completedScopeCount ?? 0,
                startedScopeCount: (activeCycle as unknown as Record<string, unknown>).startedScopeCount ?? 0,
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
      // Also handles In Review evidence checks from main
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

              // ─── In Review evidence check ─────────────────────────────
              // When an issue transitions to "In Review", look up evidence
              // of completed work (Linear comments + GitHub commits / PRs /
              // branches). If none is found, kick it back to In Progress
              // and nag the assignee. If found, auto-advance to Done and
              // notify the original reporter.
              if (issueState?.name === 'In Review') {
                console.log(`[webhook/linear] Issue ${issueId} moved to In Review — running evidence check`);
                try {
                  const db = createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
                  const ticketRow = await db.execute({
                    sql: `SELECT lt.reporter_email, lt.project_id, lt.title, p.repository_url
                          FROM local_tickets lt
                          LEFT JOIN projects p ON lt.project_id = p.id
                          WHERE lt.linear_issue_id = ?
                          LIMIT 1`,
                    args: [issueId],
                  });

                  const row = ticketRow.rows[0] as unknown as
                    | { reporter_email: string | null; project_id: string | null; title: string | null; repository_url: string | null }
                    | undefined;

                  if (!row) {
                    console.log(`[webhook/linear] No local_tickets row for ${issueId} — skipping evidence check`);
                    return c.json({ success: true, data: { received: true, action: 'in-review-check', skipped: true, reason: 'no local ticket' } });
                  }

                  const reporterEmail = row.reporter_email ?? undefined;
                  const ticketTitle = row.title ?? `Issue ${issueId}`;
                  const repoInfo = parseGithubRepo(row.repository_url);
                  const identifier = (data.identifier as string | undefined) ?? '';

                  if (!process.env.GITHUB_TOKEN && !warnedMissingGithubToken) {
                    console.warn('[webhook/linear] GITHUB_TOKEN missing — evidence check will fall back to Linear comments only');
                    warnedMissingGithubToken = true;
                  }

                  // Fetch comments + GitHub evidence in parallel.
                  const [commentsResult, githubResult] = await Promise.all([
                    getLinearIssueComments.execute?.({ issueId } as never, {} as never),
                    repoInfo && identifier && process.env.GITHUB_TOKEN
                      ? findGitHubEvidenceForIssueTool.execute?.(
                          { owner: repoInfo.owner, repo: repoInfo.repo, identifier } as never,
                          {} as never,
                        )
                      : Promise.resolve({ success: true, data: { found: false, commits: [], branches: [], pulls: [], evidenceSummary: '' } }),
                  ]);

                  const commentsOk = commentsResult && typeof commentsResult === 'object' && 'success' in commentsResult && commentsResult.success;
                  const commentsData = commentsOk
                    ? ((commentsResult as { success: true; data: { comments: Array<{ body: string; user: { name: string | null } }> } }).data.comments ?? [])
                    : [];
                  const commentsHaveEvidence = commentsData.length > 0;

                  const githubOk = githubResult && typeof githubResult === 'object' && 'success' in githubResult && githubResult.success;
                  const githubData = githubOk
                    ? (githubResult as { success: true; data: { found: boolean; evidenceSummary: string; commits: unknown[]; branches: unknown[]; pulls: unknown[] } }).data
                    : { found: false, evidenceSummary: '', commits: [], branches: [], pulls: [] };
                  const githubHasEvidence = githubData.found === true;

                  const hasEvidence = commentsHaveEvidence || githubHasEvidence;

                  if (!hasEvidence) {
                    // No evidence — move back to In Progress and nag the assignee.
                    console.log(`[webhook/linear] No evidence for ${issueId} — reverting to In Progress`);

                    const { resolveStateId } = await import('../mastra/tools/linear-state-resolver');
                    const inProgressId = await resolveStateId('IN PROGRESS', config.LINEAR_API_KEY);
                    const revertResult = inProgressId ? await updateLinearIssue.execute?.(
                      { issueId, stateId: inProgressId } as never,
                      {} as never,
                    ) : null;
                    const revertOk = !!revertResult
                      && typeof revertResult === 'object'
                      && 'success' in revertResult
                      && (revertResult as { success: unknown }).success === true;
                    if (!revertOk) {
                      console.error(
                        `[webhook/linear] Failed to revert ${issueId} to In Progress`,
                        revertResult,
                      );
                      return c.json(
                        {
                          success: false,
                          error: {
                            code: 'STATE_UPDATE_FAILED',
                            message: 'Could not revert Linear issue to In Progress',
                          },
                        },
                        500,
                      );
                    }

                    // Post a Linear comment explaining the revert.
                    try {
                      if (linearClient) {
                        await linearClient.createComment({
                          issueId,
                          body: `Automated evidence check: moved back to **In Progress**. No Linear comments or GitHub commits / branches / PRs referencing \`${identifier}\` were found. Please add a comment or link your work before moving this ticket to In Review again.`,
                        });
                      }
                    } catch (commentErr) {
                      console.error('[webhook/linear] Failed to post Linear comment:', commentErr instanceof Error ? commentErr.message : commentErr);
                    }

                    // Notify assignee (if present) via email + Slack.
                    const assigneeNode = data.assignee as { email?: string; name?: string } | undefined;
                    const assigneeEmail = assigneeNode?.email;
                    const assigneeName = assigneeNode?.name ?? 'Assignee';
                    const nagSummary = `The ticket "${ticketTitle}" was moved to In Review but no evidence of work was found (no Linear comments, no commits or PRs referencing ${identifier}). It has been moved back to In Progress. Please add evidence before re-requesting review.`;
                    const issueUrl = `${LINEAR_BASE_URL}/issue/${identifier}`;

                    if (assigneeEmail) {
                      try {
                        await sendTicketNotification.execute?.(
                          {
                            to: assigneeEmail,
                            ticketTitle: `[Evidence missing] ${ticketTitle}`.slice(0, 200),
                            severity: 'Medium',
                            priority: 3,
                            summary: nagSummary,
                            linearUrl: issueUrl,
                            assigneeName,
                            linearIssueId: issueId,
                          } as never,
                          {} as never,
                        );
                      } catch (err) {
                        console.error('[webhook/linear] Assignee email failed:', err instanceof Error ? err.message : err);
                      }
                    }

                    try {
                      await sendSlackTicketNotification.execute?.(
                        {
                          ticketTitle: `[Evidence missing] ${ticketTitle}`.slice(0, 200),
                          severity: 'Medium',
                          priority: 3,
                          summary: nagSummary,
                          linearUrl: issueUrl,
                          assigneeName,
                          linearIssueId: issueId,
                        } as never,
                        {} as never,
                      );
                    } catch (err) {
                      console.error('[webhook/linear] Assignee Slack failed:', err instanceof Error ? err.message : err);
                    }

                    return c.json({
                      success: true,
                      data: { received: true, action: 'in-review-check', verdict: 'missing-evidence', revertedTo: 'in-progress' },
                    });
                  }

                  // Evidence found — advance to Done and notify reporter.
                  console.log(`[webhook/linear] Evidence found for ${issueId} — marking Done`);

                  const { resolveStateId: resolveDoneId } = await import('../mastra/tools/linear-state-resolver');
                  const doneId = await resolveDoneId('DONE', config.LINEAR_API_KEY);
                  const advanceResult = doneId ? await updateLinearIssue.execute?.(
                    { issueId, stateId: doneId } as never,
                    {} as never,
                  ) : null;
                  const advanceOk = !!advanceResult
                    && typeof advanceResult === 'object'
                    && 'success' in advanceResult
                    && (advanceResult as { success: unknown }).success === true;
                  if (!advanceOk) {
                    console.error(
                      `[webhook/linear] Failed to advance ${issueId} to Done`,
                      advanceResult,
                    );
                    return c.json(
                      {
                        success: false,
                        error: {
                          code: 'STATE_UPDATE_FAILED',
                          message: 'Could not advance Linear issue to Done',
                        },
                      },
                      500,
                    );
                  }

                  const evidenceParts: string[] = [];
                  if (commentsHaveEvidence) {
                    const snippet = (commentsData[0]?.body ?? '').slice(0, 160);
                    evidenceParts.push(`${commentsData.length} Linear comment(s)${snippet ? ` — latest: "${snippet}"` : ''}`);
                  }
                  if (githubHasEvidence) {
                    evidenceParts.push(githubData.evidenceSummary);
                  }
                  const resolutionSummary = `Ticket "${ticketTitle}" auto-resolved. Evidence found: ${evidenceParts.join(' | ')}`;
                  const issueUrl = `${LINEAR_BASE_URL}/issue/${identifier}`;

                  if (reporterEmail) {
                    try {
                      await sendResolutionNotification.execute?.(
                        {
                          to: reporterEmail,
                          originalTitle: ticketTitle,
                          resolutionSummary,
                          linearUrl: issueUrl,
                          linearIssueId: issueId,
                        } as never,
                        {} as never,
                      );
                    } catch (err) {
                      console.error('[webhook/linear] Reporter email failed:', err instanceof Error ? err.message : err);
                    }
                  }

                  try {
                    await sendSlackResolutionNotification.execute?.(
                      {
                        originalTitle: ticketTitle,
                        resolutionSummary,
                        verdict: 'resolved',
                        linearUrl: issueUrl,
                        linearIssueId: issueId,
                      } as never,
                      {} as never,
                    );
                  } catch (err) {
                    console.error('[webhook/linear] Reporter Slack failed:', err instanceof Error ? err.message : err);
                  }

                  return c.json({
                    success: true,
                    data: {
                      received: true,
                      action: 'in-review-check',
                      verdict: 'evidence-found',
                      advancedTo: 'done',
                      commentsCount: commentsData.length,
                      githubFound: githubHasEvidence,
                    },
                  });
                } catch (evErr) {
                  console.error('[webhook/linear] Evidence check error:', evErr instanceof Error ? evErr.message : evErr);
                  return c.json({ success: false, error: { code: 'EVIDENCE_CHECK_ERROR', message: evErr instanceof Error ? evErr.message : String(evErr) } }, 500);
                }
              }

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
                const dbClient = createClient({
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
                  // Save to the conversation thread via Mastra v1.4+ memory API
                  const storage = m.getStorage() as unknown as { stores?: { memory?: { saveMessages: (args: { messages: Array<Record<string, unknown>> }) => Promise<unknown> } } };
                  if (storage?.stores?.memory?.saveMessages) {
                    // Look up resourceId from the thread's existing messages
                    const listStore = storage.stores.memory as unknown as { listMessages: (args: { threadId: string; perPage?: number | false }) => Promise<{ messages: Array<{ resourceId?: string }> }> };
                    const existing = await listStore.listMessages({ threadId, perPage: 1 }).catch(() => ({ messages: [] }));
                    const resourceId = existing.messages[0]?.resourceId ?? 'anonymous';
                    await storage.stores!.memory!.saveMessages({
                      messages: [{
                        id: `resolution-${Date.now()}`,
                        threadId,
                        resourceId,
                        role: 'assistant',
                        createdAt: new Date(),
                        content: { format: 2, parts: [{ type: 'text', text: resolutionMsg }] },
                      }],
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
                      const dbClient = createClient({
                        url: process.env.LIBSQL_URL || 'http://libsql:8080',
                      });
                      await dbClient.execute({
                        sql: `INSERT OR REPLACE INTO workflow_runs (id, run_id, thread_id, status, created_at) VALUES (?, ?, ?, 'running', ?)`,
                        args: [run.runId, run.runId, threadId, Date.now()],
                      }).catch((err: Error) => console.error('[workflow/stream] Failed to save run mapping:', err.message));
                    }

                    send({ step: 'intake', status: 'running', message: 'Analyzing incident...' });

                    // Per-step labels for user-facing progress messages
                    const stepLabels: Record<string, string> = {
                      intake: 'Analyzing incident...',
                      triage: 'Classifying severity and root cause...',
                      dedup: 'Checking for duplicates...',
                      ticket: 'Creating Linear ticket...',
                      notify: 'Sending notifications...',
                      suspend: 'Waiting for assignee to resolve the issue...',
                    };

                    // Use Mastra's native per-step streaming API. `run.stream()` returns
                    // a WorkflowRunOutput whose `fullStream` emits WorkflowStreamEvents
                    // ('workflow-step-start', 'workflow-step-result',
                    //  'workflow-step-suspended', 'workflow-paused', 'workflow-finish', ...)
                    // in real-time as the workflow executes — unlike run.start() which
                    // only resolves at the very end.
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const streamOutput = (run as any).stream({ inputData: body, closeOnSuspend: true });

                    // Track which step IDs we've already emitted a terminal event for
                    // (avoids duplicate completions if both step-result and step-suspended
                    // arrive for the same step).
                    const emittedSteps = new Set<string>();

                    for await (const event of streamOutput.fullStream as AsyncIterable<{
                      type: string;
                      payload?: Record<string, unknown>;
                    }>) {
                      const type = event.type;
                      const payload = event.payload ?? {};
                      const stepId = payload.id as string | undefined;

                      if (type === 'workflow-step-start' && stepId) {
                        // Emit a "running" event so the UI can show early "Analyzing" feedback
                        // for the first steps before they complete.
                        send({
                          step: stepId,
                          status: 'running',
                          message: stepLabels[stepId] ?? `Running ${stepId}...`,
                        });
                        continue;
                      }

                      if (type === 'workflow-step-result' && stepId) {
                        const status = payload.status as string | undefined;
                        const output = payload.output as Record<string, unknown> | undefined;

                        if (status === 'failed') {
                          const errMsg = typeof payload.error === 'string'
                            ? payload.error
                            : (payload.error as { message?: string })?.message ?? `Step ${stepId} failed`;
                          send({ step: stepId, status: 'error', message: errMsg });
                          emittedSteps.add(stepId);
                          continue;
                        }

                        // Success path
                        if (emittedSteps.has(stepId)) continue;
                        emittedSteps.add(stepId);

                        if (stepId === 'ticket' && output) {
                          send({
                            step: 'ticket',
                            status: 'completed',
                            message: `Issue created: ${output.issueId ?? 'N/A'}`,
                            data: {
                              issueId: output.issueId,
                              issueUrl: output.issueUrl,
                              wasUpdated: output.wasUpdated,
                            },
                          });
                          // Persist issueId for webhook resolution lookup
                          if (threadId && output.issueId) {
                            const dbClient2 = createClient({
                              url: process.env.LIBSQL_URL || 'http://libsql:8080',
                            });
                            dbClient2.execute({
                              sql: `UPDATE workflow_runs SET issue_id = ?, issue_url = ?, status = 'suspended' WHERE run_id = ?`,
                              args: [output.issueId as string, (output.issueUrl as string) ?? '', run.runId],
                            }).catch((err: Error) => console.error('[workflow/stream] Failed to update run mapping:', err.message));
                          }
                        } else if (stepId === 'notify' && output) {
                          send({ step: 'notify', status: 'completed', message: stepLabels.notify, data: output });
                          if (output.notificationSent) {
                            // notifiedEmail is the actual recipient (assignee, with reporter fallback).
                            const destEmail = (output.notifiedEmail as string | undefined)
                              ?? (output.reporterEmail as string | undefined);
                            if (destEmail) {
                              send({ step: 'notify-email', status: 'completed', message: `Email sent to ${destEmail}` });
                            }
                            send({ step: 'notify-slack', status: 'completed', message: 'Slack notification sent' });
                          }
                        } else {
                          send({
                            step: stepId,
                            status: 'completed',
                            message: stepLabels[stepId] ?? `Step ${stepId} completed`,
                            data: output,
                          });
                        }
                        continue;
                      }

                      if (type === 'workflow-step-suspended' && stepId) {
                        // The `suspend` step is what the frontend keys on to render
                        // "Waiting for assignee..." with the Linear link. Pull issueId
                        // and issueUrl from the suspend step's input/output since those
                        // are the canonical source at suspension time.
                        const output = (payload.output as Record<string, unknown> | undefined) ?? {};
                        const suspendInput = (payload.payload as Record<string, unknown> | undefined) ?? {};
                        const issueId = (output.issueId as string | undefined) ?? (suspendInput.issueId as string | undefined);
                        const issueUrl = (output.issueUrl as string | undefined) ?? (suspendInput.issueUrl as string | undefined);

                        if (emittedSteps.has(stepId)) continue;
                        emittedSteps.add(stepId);

                        send({
                          step: stepId === 'suspend' ? 'suspend' : stepId,
                          status: 'suspended',
                          message: stepLabels[stepId] ?? 'Workflow suspended',
                          data: { issueId, issueUrl },
                        });
                        continue;
                      }

                      if (type === 'workflow-finish' || type === 'workflow-paused' || type === 'workflow-canceled') {
                        // Terminal signals — the outer loop will exit when fullStream closes.
                        continue;
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

              const storage = m.getStorage() as unknown as { stores?: { memory?: { saveMessages: (args: { messages: Array<Record<string, unknown>> }) => Promise<unknown> } } };
              if (!storage?.stores?.memory?.saveMessages) {
                console.error('[memory] Messages store not available');
                return c.json({ success: false, error: { code: 'NO_STORAGE', message: 'Memory storage not available' } }, 500);
              }

              const contextMessage = getMemoryInitializationContext();

              // Extract resourceId (userId) from session cookie for Mastra memory requirement
              const cookie = c.req.header('cookie') || '';
              const tokenMatch = cookie.match(/better-auth\.session_token=([^;]+)/);
              const rawToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : '';
              const sessionToken = rawToken.includes('.') ? rawToken.slice(0, rawToken.indexOf('.')) : rawToken;
              let resourceId = 'anonymous';
              if (sessionToken) {
                const db = (await import('@libsql/client')).createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
                const r = await db.execute({ sql: 'SELECT user_id FROM auth_session WHERE token = ? LIMIT 1', args: [sessionToken] });
                if (r.rows[0]?.user_id) resourceId = r.rows[0].user_id as string;
              }

              await storage.stores!.memory!.saveMessages({
                messages: [{
                  id: `ctx-${threadId}`,
                  role: 'system',
                  threadId,
                  resourceId,
                  createdAt: new Date(),
                  content: { format: 2, parts: [{ type: 'text', text: contextMessage }] },
                }],
              });

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

              if (!threadId) {
                return c.json({ success: false, error: { code: 'MISSING_THREAD_ID', message: 'threadId is required' } }, 400);
              }

              // Prefer the agent's own Memory (which the chat route uses to save messages).
              // The agent's Memory uses a dedicated LibSQLStore, so reading via its
              // recall() guarantees we read from the same store that persisted the turn.
              // Falls back to Mastra top-level storage if the agent or its memory is unavailable.
              const agentId = c.req.query('agentId') || 'orchestrator';
              const agent = m.getAgentById(agentId);
              const agentMemory = agent ? await agent.getMemory?.() : null;

              if (agentMemory?.recall) {
                try {
                  const result = await agentMemory.recall({ threadId, perPage: false });
                  const msgs = Array.isArray(result?.messages) ? result.messages : [];
                  console.log(`[memory/messages] thread=${threadId} agent=${agentId} source=agentMemory count=${msgs.length}`);
                  return c.json({ messages: msgs });
                } catch (e) {
                  console.warn('[memory/messages] agentMemory.recall failed, falling back to storage:', e instanceof Error ? e.message : String(e));
                }
              }

              const storage = m.getStorage() as unknown as { stores?: { memory?: { listMessages: (args: { threadId: string; perPage?: number | false }) => Promise<{ messages: Array<Record<string, unknown>> }> } } };
              if (!storage?.stores?.memory?.listMessages) {
                console.error('[memory] Messages store not available');
                return c.json({ messages: [] });
              }

              const result = await storage.stores.memory.listMessages({ threadId, perPage: false });
              console.log(`[memory/messages] thread=${threadId} agent=${agentId} source=storage count=${result.messages?.length ?? 0}`);
              return c.json({ messages: result.messages || [] });
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
              const body = await c.req.json() as {
                threadId?: string;
                role?: string;
                content?: string;
                parts?: Array<Record<string, unknown>>;
              };

              if (!body.threadId || (!body.content && !body.parts)) {
                return c.json({ success: false, error: { code: 'MISSING_FIELDS', message: 'threadId and (content or parts) are required' } }, 400);
              }

              const storage = m.getStorage() as unknown as { stores?: { memory?: { saveMessages: (args: { messages: Array<Record<string, unknown>> }) => Promise<unknown> } } };
              if (!storage?.stores?.memory?.saveMessages) {
                return c.json({ success: false, error: { code: 'NO_STORAGE', message: 'Memory storage not available' } }, 500);
              }

              // Extract resourceId (userId) from session cookie for Mastra memory requirement
              const cookie = c.req.header('cookie') || '';
              const tokenMatch = cookie.match(/better-auth\.session_token=([^;]+)/);
              const rawToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : '';
              const sessionToken = rawToken.includes('.') ? rawToken.slice(0, rawToken.indexOf('.')) : rawToken;
              let resourceId = 'anonymous';
              if (sessionToken) {
                const db = (await import('@libsql/client')).createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
                const r = await db.execute({ sql: 'SELECT user_id FROM auth_session WHERE token = ? LIMIT 1', args: [sessionToken] });
                if (r.rows[0]?.user_id) resourceId = r.rows[0].user_id as string;
              }

              // Caller can pass either `content` (plain text) or `parts` (rich:
              // tool-invocation, reasoning, file, etc.). Always store in the
              // Mastra v2 shape: { format: 2, parts: [...] }.
              const parts = body.parts && body.parts.length > 0
                ? body.parts
                : [{ type: 'text', text: body.content ?? '' }];

              await storage.stores!.memory!.saveMessages({
                messages: [{
                  id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  resourceId,
                  role: body.role ?? 'assistant',
                  threadId: body.threadId,
                  createdAt: new Date(),
                  content: { format: 2, parts },
                }],
              });

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

      // POST /api/test/email — test Resend email sending
      {
        path: '/api/test/email',
        method: 'POST' as const,
        handler: async (c: Context) => {
          try {
            const body = await c.req.json() as { to?: string; subject?: string };
            const to = body.to || 'ricardo.soberanisr@gmail.com';
            const result = await sendTicketNotification.execute?.(
              {
                to,
                ticketTitle: body.subject || 'Triage email test',
                severity: 'Low',
                priority: 3,
                summary: 'This is a direct test of the Resend email tool from /api/test/email.',
                linearUrl: 'https://linear.app/agentic-engineering-agency',
                assigneeName: 'Test Recipient',
                linearIssueId: `test-${Date.now()}`,
              } as never,
              {} as never,
            );
            return c.json({ success: true, to, result });
          } catch (error) {
            console.error('[test/email] Error:', error);
            return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
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
