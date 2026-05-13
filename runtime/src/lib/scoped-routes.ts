/**
 * Project-scoped API routes — all routes under /projects/:projectId/*
 *
 * Every handler gates on `assertProjectOwnership` before touching project
 * data. Linear credentials are resolved via `getIntegrationKey` with env
 * fallback — same path as tools and agents so the UI can seed per-project
 * keys and see them take effect end-to-end.
 *
 * Routes:
 *   GET  /projects/:projectId/linear/issues       — issues for this project's Linear team
 *   GET  /projects/:projectId/linear/cycle        — active cycle for this project
 *   GET  /projects/:projectId/linear/members      — team members for this project
 *   POST /projects/:projectId/wiki/generate       — generate wiki for this project's repo
 *   GET  /projects/:projectId/wiki/status         — wiki generation status
 */
import { registerApiRoute } from '@mastra/core/server';
import { createClient, type Client } from '@libsql/client';
import { LinearClient } from '@linear/sdk';
import type { Context } from 'hono';
import { assertProjectOwnership, authErrorResponse } from './auth-helpers';
import { getIntegrationKey } from './integration-keys';
import { generateWiki } from './wiki-rag';
import { setWebhookSecret, LINEAR_PROVIDER } from './webhook-secrets';

let cachedClient: Client | null = null;
function getDb(): Client {
  if (cachedClient) return cachedClient;
  cachedClient = createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
  return cachedClient;
}

export function __setClientForTests(client: Client | null): void {
  cachedClient = client;
}

/**
 * Helper: get project by ID, returns null if not found
 */
async function getProject(projectId: string) {
  const db = getDb();
  const result = await db.execute('SELECT * FROM projects WHERE id = ?', [projectId]);
  return result.rows[0] || null;
}

type LinearContext =
  | { ok: true; apiKey: string; teamId: string }
  | { ok: false; reason: 'no_key' | 'no_team' };

/**
 * Resolve the API key + team id for a project's Linear integration.
 *
 * Tenant row required: key + meta.teamId come from the encrypted
 * `project_integrations` row the user set up in /integrations. The
 * pre-multi-tenant env-fallback path (which read `projects.linear_team_id`)
 * was removed alongside the plaintext-columns drop — projects must be
 * onboarded through the new UI to use `/projects/:id/linear/*`.
 */
async function resolveLinearContext(projectId: string): Promise<LinearContext> {
  const tenant = await getIntegrationKey(projectId, 'linear');
  if (!tenant.ok) return { ok: false, reason: 'no_key' };
  const teamId = tenant.meta.teamId;
  if (!teamId) return { ok: false, reason: 'no_team' };
  return { ok: true, apiKey: tenant.plaintext, teamId };
}

function linearConfigError(c: Context, reason: 'no_key' | 'no_team') {
  const message =
    reason === 'no_team'
      ? 'Linear team not selected for this project — re-run Save in /integrations'
      : 'Linear integration not configured for this project';
  return c.json(
    { success: false, error: { code: 'NO_LINEAR_CONFIG', message } },
    400,
  );
}

// ---------- GET /api/projects/:projectId/linear/issues ----------
export const listProjectIssuesRoute = registerApiRoute('/projects/:projectId/linear/issues', {
  method: 'GET' as const,
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId');
      if (!projectId) return authErrorResponse(c, 404);
      const auth = await assertProjectOwnership(c, projectId);
      if (!auth.ok) return authErrorResponse(c, auth.status);

      const lc = await resolveLinearContext(projectId);
      if (!lc.ok) return linearConfigError(c, lc.reason);

      const linearClient = new LinearClient({ apiKey: lc.apiKey });
      const issues = await linearClient.issues({
        filter: { team: { id: { eq: lc.teamId } } },
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
        } catch {
          /* project may not exist */
        }

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
          labels: labelsConnection.nodes.map((l: { id: string; name: string; color: string }) => ({
            id: l.id,
            name: l.name,
            color: l.color,
          })),
        });
      }

      return c.json({ success: true, data: grouped });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: { code: 'LINEAR_ERROR', message } }, 500);
    }
  },
});

// ---------- GET /api/projects/:projectId/linear/cycle ----------
export const getProjectCycleRoute = registerApiRoute('/projects/:projectId/linear/cycle', {
  method: 'GET' as const,
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId');
      if (!projectId) return authErrorResponse(c, 404);
      const auth = await assertProjectOwnership(c, projectId);
      if (!auth.ok) return authErrorResponse(c, auth.status);

      const lc = await resolveLinearContext(projectId);
      if (!lc.ok) return linearConfigError(c, lc.reason);

      const linearClient = new LinearClient({ apiKey: lc.apiKey });
      const team = await linearClient.team(lc.teamId);
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
});

// ---------- GET /api/projects/:projectId/linear/members ----------
export const listProjectMembersRoute = registerApiRoute('/projects/:projectId/linear/members', {
  method: 'GET' as const,
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId');
      if (!projectId) return authErrorResponse(c, 404);
      const auth = await assertProjectOwnership(c, projectId);
      if (!auth.ok) return authErrorResponse(c, auth.status);

      const lc = await resolveLinearContext(projectId);
      if (!lc.ok) return linearConfigError(c, lc.reason);

      const linearClient = new LinearClient({ apiKey: lc.apiKey });
      const team = await linearClient.team(lc.teamId);
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
});

// Per-project sync tracking (mirrors linear-sync.ts globals but keyed by project)
const projectSyncMeta = new Map<
  string,
  { lastSyncedAt: Date | null; syncInProgress: boolean }
>()

function getProjectSyncMeta(projectId: string) {
  if (!projectSyncMeta.has(projectId)) {
    projectSyncMeta.set(projectId, { lastSyncedAt: null, syncInProgress: false })
  }
  return projectSyncMeta.get(projectId)!
}

async function syncProjectLinearIssues(
  projectId: string,
  apiKey: string,
  teamId: string,
): Promise<Record<string, Array<Record<string, unknown>>>> {
  const meta = getProjectSyncMeta(projectId)
  if (meta.syncInProgress) {
    console.log(`[linear-sync] Sync already in progress for ${projectId}, skipping`)
    const cached = await getCachedProjectIssues(projectId)
    if (cached) return cached
    throw new Error('Sync in progress and no cached data available')
  }

  meta.syncInProgress = true
  console.log(`[linear-sync] Starting sync for project ${projectId}...`)
  const startTime = Date.now()

  try {
    const linearClient = new LinearClient({ apiKey })
    const issues = await linearClient.issues({
      filter: { team: { id: { eq: teamId } } },
      first: 50,
    })

    const grouped: Record<string, Array<Record<string, unknown>>> = {}
    for (const issue of issues.nodes) {
      const state = await issue.state
      const stateName = state?.name ?? 'Unknown'
      if (!grouped[stateName]) grouped[stateName] = []

      const assigneeNode = await issue.assignee
      const labelsConnection = await issue.labels()
      let projectName: string | null = null
      try {
        const proj = await issue.project
        if (proj) projectName = proj.name
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
        labels: labelsConnection.nodes.map((l: { id: string; name: string; color: string }) => ({
          id: l.id,
          name: l.name,
          color: l.color,
        })),
      })
    }

    const db = getDb()
    const now = Date.now()
    await db.execute({
      sql: `INSERT OR REPLACE INTO linear_sync_cache (id, team_id, data, synced_at)
            VALUES (?, ?, ?, ?)`,
      args: [projectId, teamId, JSON.stringify(grouped), now],
    })

    meta.lastSyncedAt = new Date(now)
    const elapsed = Date.now() - startTime
    const totalIssues = Object.values(grouped).flat().length
    console.log(`[linear-sync] Sync complete for ${projectId}: ${totalIssues} issues in ${elapsed}ms`)
    return grouped
  } finally {
    meta.syncInProgress = false
  }
}

async function getCachedProjectIssues(
  projectId: string,
): Promise<Record<string, Array<Record<string, unknown>>> | null> {
  try {
    const db = getDb()
    const result = await db.execute({
      sql: 'SELECT data, synced_at FROM linear_sync_cache WHERE id = ?',
      args: [projectId],
    })
    const row = result.rows[0]
    if (!row) return null
    const meta = getProjectSyncMeta(projectId)
    if (!meta.lastSyncedAt && row.synced_at) {
      meta.lastSyncedAt = new Date(Number(row.synced_at))
    }
    return JSON.parse(row.data as string) as Record<string, Array<Record<string, unknown>>>
  } catch (error) {
    console.error(
      `[linear-sync] Failed to read cache for ${projectId}:`,
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

function getProjectLastSyncedAt(projectId: string): Date | null {
  return getProjectSyncMeta(projectId).lastSyncedAt
}

function isProjectSyncInProgress(projectId: string): boolean {
  return getProjectSyncMeta(projectId).syncInProgress
}

// ---------- POST /api/projects/:projectId/linear/sync ----------
export const syncProjectIssuesRoute = registerApiRoute('/projects/:projectId/linear/sync', {
  method: 'POST' as const,
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId')
      if (!projectId) return authErrorResponse(c, 404)
      const auth = await assertProjectOwnership(c, projectId)
      if (!auth.ok) return authErrorResponse(c, auth.status)

      const lc = await resolveLinearContext(projectId)
      if (!lc.ok) return linearConfigError(c, lc.reason)

      const grouped = await syncProjectLinearIssues(projectId, lc.apiKey, lc.teamId)
      const totalIssues = Object.values(grouped).flat().length
      return c.json({
        success: true,
        data: {
          issueCount: totalIssues,
          syncedAt: getProjectLastSyncedAt(projectId)?.toISOString() ?? null,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ success: false, error: { code: 'LINEAR_ERROR', message } }, 500)
    }
  },
})

// ---------- GET /api/projects/:projectId/linear/sync/status ----------
export const getProjectSyncStatusRoute = registerApiRoute('/projects/:projectId/linear/sync/status', {
  method: 'GET' as const,
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId')
      if (!projectId) return authErrorResponse(c, 404)
      const auth = await assertProjectOwnership(c, projectId)
      if (!auth.ok) return authErrorResponse(c, auth.status)

      return c.json({
        success: true,
        data: {
          lastSyncedAt: getProjectLastSyncedAt(projectId)?.toISOString() ?? null,
          syncInProgress: isProjectSyncInProgress(projectId),
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ success: false, error: { code: 'LINEAR_ERROR', message } }, 500)
    }
  },
})

// ---------- POST /api/projects/:projectId/linear/webhook/setup ----------
export const setupProjectWebhookRoute = registerApiRoute('/projects/:projectId/linear/webhook/setup', {
  method: 'POST' as const,
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId')
      if (!projectId) return authErrorResponse(c, 404)
      const auth = await assertProjectOwnership(c, projectId)
      if (!auth.ok) return authErrorResponse(c, auth.status)

      const lc = await resolveLinearContext(projectId)
      if (!lc.ok) return linearConfigError(c, lc.reason)

      const body = (await c.req.json()) as { url?: string }
      if (!body.url) {
        return c.json({ success: false, error: { code: 'MISSING_URL', message: 'url is required' } }, 400)
      }

      const linearClient = new LinearClient({ apiKey: lc.apiKey })
      const result = await linearClient.createWebhook({
        url: body.url,
        teamId: lc.teamId,
        resourceTypes: ['Issue'],
        enabled: true,
      })
      const webhook = await result.webhook

      if (webhook?.secret) {
        await setWebhookSecret(LINEAR_PROVIDER, webhook.secret, webhook.id ?? null, projectId)
      } else {
        console.warn(`[webhook/setup] Linear response missing secret for project ${projectId}`)
      }

      return c.json({
        success: true,
        data: {
          id: webhook?.id,
          url: webhook?.url,
          enabled: webhook?.enabled,
          secretStored: Boolean(webhook?.secret),
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ success: false, error: { code: 'LINEAR_ERROR', message } }, 500)
    }
  },
})


// ---------- POST /api/projects/:projectId/wiki/generate ----------
export const generateProjectWikiRoute = registerApiRoute('/projects/:projectId/wiki/generate', {
  method: 'POST' as const,
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId');
      if (!projectId) return authErrorResponse(c, 404);
      const auth = await assertProjectOwnership(c, projectId);
      if (!auth.ok) return authErrorResponse(c, auth.status);

      const project = await getProject(projectId);
      if (!project) return authErrorResponse(c, 404);

      // Defense-in-depth: if GitHub probe flipped this project to needs_auth
      // (private repo without a PAT), refuse to spawn another clone attempt.
      // The retry button in GitHubCard goes through PUT /integrations/github
      // which sets up the PAT first; any other caller hitting this endpoint
      // without a configured PAT would just produce another auth failure.
      if (project.status === 'needs_auth') {
        return c.json(
          {
            success: false,
            error: {
              code: 'PROJECT_NEEDS_AUTH',
              message:
                'Private repository — connect a GitHub PAT in /integrations before generating the wiki',
            },
          },
          400,
        );
      }

      const db = getDb();
      const now = Date.now();

      // Update project status to processing
      await db.execute(
        'UPDATE projects SET status = ?, updated_at = ? WHERE id = ?',
        ['processing', now, projectId],
      );

      console.log(`[wiki/generate] Starting wiki generation for project: ${projectId}`);

      // Run in background (non-blocking)
      generateWiki(projectId, project.repo_url as string, project.repo_default_branch as string).catch((err: Error) => {
        console.error(`[wiki/generate] Pipeline error for ${projectId}: ${err.message}`);
      });

      return c.json({
        success: true,
        data: { status: 'processing', projectId, repoUrl: project.repo_url },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: { code: 'WIKI_ERROR', message } }, 500);
    }
  },
});

// ---------- GET /api/projects/:projectId/wiki/status ----------
export const getProjectWikiStatusRoute = registerApiRoute('/projects/:projectId/wiki/status', {
  method: 'GET' as const,
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId');
      if (!projectId) return authErrorResponse(c, 404);
      const auth = await assertProjectOwnership(c, projectId);
      if (!auth.ok) return authErrorResponse(c, auth.status);

      const project = await getProject(projectId);
      if (!project) return authErrorResponse(c, 404);

      const db = getDb();

      // Count documents and chunks for this project
      const docsResult = await db.execute('SELECT COUNT(*) as count FROM wiki_documents WHERE project_id = ?', [
        projectId,
      ]);
      const chunksResult = await db.execute(
        'SELECT COUNT(*) as count FROM wiki_chunks WHERE document_id IN (SELECT id FROM wiki_documents WHERE project_id = ?)',
        [projectId],
      );

      const docCount = Number(docsResult.rows[0]?.count ?? 0);
      const chunkCount = Number(chunksResult.rows[0]?.count ?? 0);
      const done = project.status === 'ready' || project.status === 'error';

      return c.json({
        success: true,
        data: {
          total: docCount + chunkCount,
          processed: chunkCount,
          done,
          status: project.status,
          error: project.wiki_error || undefined,
          documents: docCount,
          chunks: chunkCount,
        },
      });
    } catch (err) {
      console.error('[wiki/status] Error:', err instanceof Error ? err.message : 'unknown');
      return c.json({ success: true, data: { total: 0, processed: 0, done: false, status: 'error' } });
    }
  },
});

export const scopedRoutes = [
  listProjectIssuesRoute,
  getProjectCycleRoute,
  listProjectMembersRoute,
  syncProjectIssuesRoute,
  getProjectSyncStatusRoute,
  setupProjectWebhookRoute,
  generateProjectWikiRoute,
  getProjectWikiStatusRoute,
]
