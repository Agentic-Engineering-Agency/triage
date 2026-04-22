/**
 * Project management API routes — CRUD for projects and wiki generation triggers.
 *
 * Routes:
 *   GET  /projects             — list all projects (scoped to user)
 *   POST /projects             — create project + trigger wiki generation
 *   GET  /projects/:id         — get project details with stats
 *   PATCH /projects/:id        — update project
 *   DELETE /projects/:id       — delete project and its wiki data
 *   POST /projects/init-default — create default project for first-login
 */
import { registerApiRoute } from '@mastra/core/server';
import { createClient, type Client } from '@libsql/client';
import crypto from 'crypto';
import { generateWiki } from './wiki-rag';
import { extractSessionToken } from './auth-helpers';
import { parseGithubRepoUrl } from './github-repo';

let cachedClient: Client | null = null;
function getDb(): Client {
  if (cachedClient) return cachedClient;
  cachedClient = createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
  return cachedClient;
}

export function __setClientForTests(client: Client | null): void {
  cachedClient = client;
}

// Probe the public GitHub API to detect whether a repo is reachable without
// auth. Short timeout because this is in the critical path of project
// creation — a slow GitHub must not block the user. Network/timeout errors
// fall back to "treat as public" so one-off flakiness can't put projects in
// needs_auth limbo.
type RepoProbeOutcome = 'public' | 'needs_auth' | 'fallback_public';

async function probeGithubRepoVisibility(
  owner: string,
  repo: string,
  timeoutMs = 2000,
): Promise<RepoProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'triage-probe',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controller.signal,
    });
    if (res.status === 200) return 'public';
    if (res.status === 404 || res.status === 403) return 'needs_auth';
    return 'fallback_public';
  } catch (err) {
    console.warn(
      `[projects] GitHub probe failed for ${owner}/${repo}, treating as public: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 'fallback_public';
  } finally {
    clearTimeout(timer);
  }
}

// ---------- POST /projects/init-default ----------
// Create a default project for the authenticated user on first login
export const initDefaultProjectRoute = registerApiRoute('/projects/init-default', {
  method: 'POST',
  handler: async (c) => {
    try {
      const cookieHeader = c.req.header('cookie');
      const sessionToken = extractSessionToken(cookieHeader);

      if (!sessionToken) {
        return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No session found' } }, 401);
      }

      const db = getDb();

      // Get user ID from session token
      const sessionResult = await db.execute(
        'SELECT user_id FROM auth_session WHERE token = ? LIMIT 1',
        [sessionToken]
      );

      if (sessionResult.rows.length === 0) {
        return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid session' } }, 401);
      }

      const userId = sessionResult.rows[0].user_id as string;

      // Check if user already has a project
      const existingProjects = await db.execute(
        'SELECT id FROM projects WHERE user_id = ? LIMIT 1',
        [userId]
      );

      if (existingProjects.rows.length > 0) {
        // User already has a project, just return it
        const projectId = existingProjects.rows[0].id as string;
        const projectResult = await db.execute(
          'SELECT id, name, repo_url, repo_default_branch FROM projects WHERE id = ?',
          [projectId]
        );
        const row = projectResult.rows[0];
        return c.json({
          success: true,
          data: {
            id: row.id,
            name: row.name,
            repositoryUrl: row.repo_url,
            branch: row.repo_default_branch,
          },
        });
      }

      // Create default project
      const projectId = crypto.randomUUID();
      const now = Date.now();

      await db.execute({
        sql: `INSERT INTO projects (id, user_id, name, repo_url, repo_default_branch, wiki_status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [projectId, userId, 'Default Project', '', 'main', 'idle', now, now],
      });

      return c.json(
        {
          success: true,
          data: {
            id: projectId,
            name: 'Default Project',
            repositoryUrl: '',
            branch: 'main',
          },
        },
        201
      );
    } catch (error) {
      console.error('[projects] Error initializing default project:', error);
      const message = error instanceof Error ? error.message : 'Failed to initialize project';
      return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  },
});

// ---------- GET /projects ----------
export const listProjectsRoute = registerApiRoute('/projects', {
  method: 'GET',
  handler: async (c) => {
    try {
      const cookieHeader = c.req.header('cookie');
      const sessionToken = extractSessionToken(cookieHeader);

      if (!sessionToken) {
        return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No session found' } }, 401);
      }

      const db = getDb();

      // Get user ID from session token
      const sessionResult = await db.execute(
        'SELECT user_id FROM auth_session WHERE token = ? LIMIT 1',
        [sessionToken]
      );

      if (sessionResult.rows.length === 0) {
        return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid session' } }, 401);
      }

      const userId = sessionResult.rows[0].user_id as string;

      const result = await db.execute(
        'SELECT id, name, repo_url, repo_default_branch, status, documents_count, chunks_count, wiki_error, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY created_at DESC',
        [userId]
      );

      const projects = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        repositoryUrl: row.repo_url,
        branch: row.repo_default_branch,
        status: row.status,
        documentsCount: row.documents_count,
        chunksCount: row.chunks_count,
        error: row.wiki_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      return c.json({ success: true, data: projects });
    } catch (error) {
      console.error('[projects] Error listing projects:', error);
      const message = error instanceof Error ? error.message : 'Failed to list projects';
      return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  },
});

// ---------- POST /projects ----------
export const createProjectRoute = registerApiRoute('/projects', {
  method: 'POST',
  handler: async (c) => {
    try {
      const cookieHeader = c.req.header('cookie');
      const sessionToken = extractSessionToken(cookieHeader);

      if (!sessionToken) {
        return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No session found' } }, 401);
      }

      const body = await c.req.json();
      const { name, repositoryUrl, branch } = body as {
        name: string;
        repositoryUrl: string;
        branch?: string;
      };

      if (!name || !repositoryUrl) {
        return c.json({ success: false, error: { code: 'VALIDATION', message: 'name and repositoryUrl are required' } }, 400);
      }

      const db = getDb();

      // Get user ID from session token
      const sessionResult = await db.execute(
        'SELECT user_id FROM auth_session WHERE token = ? LIMIT 1',
        [sessionToken]
      );

      if (sessionResult.rows.length === 0) {
        return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid session' } }, 401);
      }

      const userId = sessionResult.rows[0].user_id as string;
      const id = crypto.randomUUID();
      const now = Date.now();

      await db.execute({
        sql: `INSERT INTO projects (id, user_id, name, repo_url, repo_default_branch, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        args: [id, userId, name, repositoryUrl, branch || 'main', now, now],
      });

      // Pattern C: probe GitHub public API to detect private repos up front.
      // Non-GitHub URLs (GitLab, Bitbucket, self-hosted) skip the probe and
      // keep today's "just try cloning" behaviour — the probe is a GitHub
      // optimisation, not a gate.
      let finalStatus: 'pending' | 'needs_auth' = 'pending';
      let wikiError: string | null = null;
      let shouldGenerateWiki = true;
      const parsed = parseGithubRepoUrl(repositoryUrl);
      if (parsed) {
        const outcome = await probeGithubRepoVisibility(parsed.owner, parsed.repo);
        if (outcome === 'needs_auth') {
          finalStatus = 'needs_auth';
          wikiError =
            'Private repo or not found. Connect GitHub in /integrations to enable wiki.';
          shouldGenerateWiki = false;
          await db.execute({
            sql: `UPDATE projects SET status = ?, wiki_error = ?, updated_at = ? WHERE id = ?`,
            args: [finalStatus, wikiError, Date.now(), id],
          });
        }
        // 'public' and 'fallback_public' both proceed with the default path.
      }

      const project = {
        id,
        name,
        repositoryUrl,
        branch: branch || 'main',
        status: finalStatus,
        documentsCount: 0,
        chunksCount: 0,
        error: wikiError,
        createdAt: now,
        updatedAt: now,
      };

      if (shouldGenerateWiki) {
        generateWiki(id, repositoryUrl, branch).catch((err) => {
          console.error(`[projects] Background wiki generation failed for ${id}:`, err);
        });
      }

      return c.json({ success: true, data: project }, 201);
    } catch (error) {
      console.error('[projects] Error creating project:', error);
      const message = error instanceof Error ? error.message : 'Failed to create project';
      return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  },
});

// ---------- GET /projects/:id ----------
export const getProjectRoute = registerApiRoute('/projects/:id', {
  method: 'GET',
  handler: async (c) => {
    try {
      const cookieHeader = c.req.header('cookie');
      const sessionToken = extractSessionToken(cookieHeader);

      if (!sessionToken) {
        return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No session found' } }, 401);
      }

      const db = getDb();

      // Get user ID from session token
      const sessionResult = await db.execute(
        'SELECT user_id FROM auth_session WHERE token = ? LIMIT 1',
        [sessionToken]
      );

      if (sessionResult.rows.length === 0) {
        return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid session' } }, 401);
      }

      const userId = sessionResult.rows[0].user_id as string;
      const id = c.req.param('id');

      const result = await db.execute({
        sql: 'SELECT * FROM projects WHERE id = ? AND user_id = ?',
        args: [id, userId],
      });

      if (result.rows.length === 0) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
      }

      const row = result.rows[0];
      const project = {
        id: row.id,
        name: row.name,
        repositoryUrl: row.repo_url,
        branch: row.repo_default_branch,
        status: row.status,
        documentsCount: row.documents_count,
        chunksCount: row.chunks_count,
        error: row.wiki_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      return c.json({ success: true, data: project });
    } catch (error) {
      console.error('[projects] Error getting project:', error);
      const message = error instanceof Error ? error.message : 'Failed to get project';
      return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  },
});

// ---------- PATCH /projects/:id ----------
export const updateProjectRoute = registerApiRoute('/projects/:id', {
  method: 'PATCH',
  handler: async (c) => {
    try {
      const cookieHeader = c.req.header('cookie');
      const sessionToken = extractSessionToken(cookieHeader);

      if (!sessionToken) {
        return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No session found' } }, 401);
      }

      const db = getDb();

      // Get user ID from session token
      const sessionResult = await db.execute(
        'SELECT user_id FROM auth_session WHERE token = ? LIMIT 1',
        [sessionToken]
      );

      if (sessionResult.rows.length === 0) {
        return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid session' } }, 401);
      }

      const userId = sessionResult.rows[0].user_id as string;
      const id = c.req.param('id');
      const body = await c.req.json();
      const { name, repositoryUrl, branch, description } = body as {
        name?: string;
        repositoryUrl?: string;
        branch?: string;
        description?: string;
      };

      // Check project exists and belongs to user
      const existing = await db.execute({
        sql: 'SELECT * FROM projects WHERE id = ? AND user_id = ?',
        args: [id, userId],
      });

      if (existing.rows.length === 0) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
      }

      const row = existing.rows[0];
      const updatedName = name ?? row.name;
      const updatedUrl = repositoryUrl ?? row.repo_url;
      const updatedBranch = branch ?? row.repo_default_branch;
      const now = Date.now();

      await db.execute({
        sql: `UPDATE projects SET name = ?, repo_url = ?, repo_default_branch = ?, updated_at = ? WHERE id = ?`,
        args: [updatedName, updatedUrl, updatedBranch, now, id],
      });

      return c.json({
        success: true,
        data: {
          id,
          name: updatedName,
          repositoryUrl: updatedUrl,
          branch: updatedBranch,
          status: row.status,
          documentsCount: row.documents_count,
          chunksCount: row.chunks_count,
          error: row.wiki_error,
          createdAt: row.created_at,
          updatedAt: now,
        },
      });
    } catch (error) {
      console.error('[projects] Error updating project:', error);
      const message = error instanceof Error ? error.message : 'Failed to update project';
      return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  },
});

// ---------- DELETE /projects/:id ----------
export const deleteProjectRoute = registerApiRoute('/projects/:id', {
  method: 'DELETE',
  handler: async (c) => {
    try {
      const cookieHeader = c.req.header('cookie');
      const sessionToken = extractSessionToken(cookieHeader);

      if (!sessionToken) {
        return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No session found' } }, 401);
      }

      const db = getDb();

      // Get user ID from session token
      const sessionResult = await db.execute(
        'SELECT user_id FROM auth_session WHERE token = ? LIMIT 1',
        [sessionToken]
      );

      if (sessionResult.rows.length === 0) {
        return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid session' } }, 401);
      }

      const userId = sessionResult.rows[0].user_id as string;
      const id = c.req.param('id');

      // Cascade deletes wiki_documents and wiki_chunks via FK
      const result = await db.execute({
        sql: 'DELETE FROM projects WHERE id = ? AND user_id = ?',
        args: [id, userId],
      });

      if (result.rowsAffected === 0) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
      }

      return c.json({ success: true, data: { id } });
    } catch (error) {
      console.error('[projects] Error deleting project:', error);
      const message = error instanceof Error ? error.message : 'Failed to delete project';
      return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  },
});

export const projectRoutes = [
  initDefaultProjectRoute,
  listProjectsRoute,
  createProjectRoute,
  getProjectRoute,
  updateProjectRoute,
  deleteProjectRoute,
];
