/**
 * Project-scoped API routes — all routes under /projects/:projectId/*
 *
 * These routes are scoped to a specific project and use that project's
 * integration credentials (Linear token, Slack webhook, GitHub token, etc.)
 *
 * Routes:
 *   GET  /projects/:projectId/linear/issues       — issues for this project's Linear team
 *   GET  /projects/:projectId/linear/cycle        — active cycle for this project
 *   GET  /projects/:projectId/linear/members      — team members for this project
 *   POST /projects/:projectId/wiki/generate       — generate wiki for this project's repo
 *   GET  /projects/:projectId/wiki/status         — wiki generation status
 */
import { registerApiRoute } from '@mastra/core/server';
import { createClient } from '@libsql/client';
import { LinearClient } from '@linear/sdk';
import type { Context } from 'hono';
import { generateWiki } from './wiki-rag';

function getDb() {
  return createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
}

/**
 * Helper: get project by ID, returns null if not found
 */
async function getProject(projectId: string) {
  const db = getDb();
  const result = await db.execute('SELECT * FROM projects WHERE id = ?', [projectId]);
  return result.rows[0] || null;
}

// ---------- GET /api/projects/:projectId/linear/issues ----------
export const listProjectIssuesRoute = registerApiRoute('/projects/:projectId/linear/issues', {
  method: 'GET' as const,
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId');
      const project = await getProject(projectId);

      if (!project) {
        return c.json({ success: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } }, 404);
      }

      if (!project.linear_token) {
        return c.json(
          {
            success: false,
            error: {
              code: 'NO_LINEAR_CONFIG',
              message: 'Linear integration not configured for this project',
            },
          },
          400,
        );
      }

      const linearClient = new LinearClient({ apiKey: project.linear_token as string });
      const issues = await linearClient.issues({
        filter: { team: { id: { eq: project.linear_team_id as string } } },
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
      const project = await getProject(projectId);

      if (!project) {
        return c.json({ success: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } }, 404);
      }

      if (!project.linear_token) {
        return c.json(
          {
            success: false,
            error: {
              code: 'NO_LINEAR_CONFIG',
              message: 'Linear integration not configured for this project',
            },
          },
          400,
        );
      }

      const linearClient = new LinearClient({ apiKey: project.linear_token as string });
      const team = await linearClient.team(project.linear_team_id as string);
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
});

// ---------- GET /api/projects/:projectId/linear/members ----------
export const listProjectMembersRoute = registerApiRoute('/projects/:projectId/linear/members', {
  method: 'GET' as const,
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId');
      const project = await getProject(projectId);

      if (!project) {
        return c.json({ success: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } }, 404);
      }

      if (!project.linear_token) {
        return c.json(
          {
            success: false,
            error: {
              code: 'NO_LINEAR_CONFIG',
              message: 'Linear integration not configured for this project',
            },
          },
          400,
        );
      }

      const linearClient = new LinearClient({ apiKey: project.linear_token as string });
      const team = await linearClient.team(project.linear_team_id as string);
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

// ---------- POST /api/projects/:projectId/wiki/generate ----------
export const generateProjectWikiRoute = registerApiRoute('/projects/:projectId/wiki/generate', {
  method: 'POST' as const,
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId');
      const project = await getProject(projectId);

      if (!project) {
        return c.json({ success: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } }, 404);
      }

      const db = getDb();
      const now = Date.now();

      // Update project status to processing
      await db.execute(
        'UPDATE projects SET wiki_status = ?, updated_at = ? WHERE id = ?',
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
      const project = await getProject(projectId);

      if (!project) {
        return c.json({ success: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } }, 404);
      }

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
      const done = project.wiki_status === 'ready' || project.wiki_status === 'error';

      return c.json({
        success: true,
        data: {
          total: docCount + chunkCount,
          processed: chunkCount,
          done,
          status: project.wiki_status,
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
  generateProjectWikiRoute,
  getProjectWikiStatusRoute,
];
