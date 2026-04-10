import { Mastra } from '@mastra/core';
import { registerApiRoute } from '@mastra/core/server';
import { LibSQLStore } from '@mastra/libsql';
import { chatRoute } from '@mastra/ai-sdk';
import { LinearClient } from '@linear/sdk';
import type { Context } from 'hono';

import { orchestrator, triageAgent, resolutionReviewer, codeReviewAgent } from './agents/index';
import { triageWorkflow } from './workflows/index';
import { auth } from '../lib/auth';
import { projectRoutes } from '../lib/project-routes';
import { webhookRoutes } from '../lib/webhook-routes';
import { config, LINEAR_CONSTANTS, LINEAR_BASE_URL } from '../lib/config';
import { createClient } from '@libsql/client';
import { getLinearIssueComments, updateLinearIssue } from './tools/linear';
import { findGitHubEvidenceForIssueTool } from './tools/github';
import { sendTicketNotification, sendResolutionNotification } from './tools/resend';
import { sendSlackTicketNotification, sendSlackResolutionNotification } from './tools/slack';

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

                    await updateLinearIssue.execute?.(
                      { issueId, stateId: LINEAR_CONSTANTS.STATES.IN_PROGRESS } as never,
                      {} as never,
                    );

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

                  await updateLinearIssue.execute?.(
                    { issueId, stateId: LINEAR_CONSTANTS.STATES.DONE } as never,
                    {} as never,
                  );

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

              workflowRun.resume({
                step: 'suspend',
                resumeData: { newStatus: issueState.name ?? 'Done', updatedAt },
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

      // Project management and simple webhook routes
      ...projectRoutes,
      ...webhookRoutes,
    ],
  },
});
