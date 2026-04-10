/**
 * Project management API routes — CRUD for projects and wiki generation triggers.
 *
 * Routes:
 *   GET  /projects         — list all projects
 *   POST /projects         — create project + trigger wiki generation
 *   GET  /projects/:id     — get project details with stats
 *   DELETE /projects/:id   — delete project and its wiki data
 */
import { registerApiRoute } from '@mastra/core/server';
import { createClient } from '@libsql/client';
import crypto from 'crypto';
import { generateWiki } from './wiki-rag';

function getDb() {
  return createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
}

// Helper to get userId from session cookie
function getUserIdFromCookies(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const sessionMatch = cookieHeader.match(/session=([^;]+)/);
  if (!sessionMatch) return null;

  const sessionToken = sessionMatch[1];
  // In a real app, you'd decrypt and validate this session token
  // For now, we'll look it up in the auth_session table
  return sessionToken;
}

// ---------- POST /projects/init-default ----------
// Create a default project for the authenticated user on first login
export const initDefaultProjectRoute = registerApiRoute('/projects/init-default', {
  method: 'POST',
  handler: async (c) => {
    try {
      const cookieHeader = c.req.header('cookie');
      const sessionToken = cookieHeader?.match(/session=([^;]+)/)?.[1];

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
    const db = getDb();
    const result = await db.execute(
      'SELECT id, name, repo_url, repo_default_branch, status, documents_count, chunks_count, wiki_error, created_at, updated_at FROM projects ORDER BY created_at DESC',
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
  },
});

// ---------- POST /projects ----------
export const createProjectRoute = registerApiRoute('/projects', {
  method: 'POST',
  handler: async (c) => {
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
    const id = crypto.randomUUID();
    const now = Date.now();

    await db.execute({
      sql: `INSERT INTO projects (id, name, repo_url, repo_default_branch, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      args: [id, name, repositoryUrl, branch || 'main', now, now],
    });

    const project = {
      id,
      name,
      repositoryUrl,
      branch: branch || 'main',
      status: 'pending',
      documentsCount: 0,
      chunksCount: 0,
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    // Trigger wiki generation in the background (non-blocking)
    generateWiki(id, repositoryUrl, branch).catch((err) => {
      console.error(`[projects] Background wiki generation failed for ${id}:`, err);
    });

    return c.json({ success: true, data: project }, 201);
  },
});

// ---------- GET /projects/:id ----------
export const getProjectRoute = registerApiRoute('/projects/:id', {
  method: 'GET',
  handler: async (c) => {
    const id = c.req.param('id');
    const db = getDb();

    const result = await db.execute({
      sql: 'SELECT * FROM projects WHERE id = ?',
      args: [id],
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
  },
});

// ---------- PATCH /projects/:id ----------
export const updateProjectRoute = registerApiRoute('/projects/:id', {
  method: 'PATCH',
  handler: async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { name, repositoryUrl, branch, description } = body as {
      name?: string;
      repositoryUrl?: string;
      branch?: string;
      description?: string;
    };

    const db = getDb();

    // Check project exists
    const existing = await db.execute({
      sql: 'SELECT * FROM projects WHERE id = ?',
      args: [id],
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
  },
});

// ---------- DELETE /projects/:id ----------
export const deleteProjectRoute = registerApiRoute('/projects/:id', {
  method: 'DELETE',
  handler: async (c) => {
    const id = c.req.param('id');
    const db = getDb();

    // Cascade deletes wiki_documents and wiki_chunks via FK
    const result = await db.execute({
      sql: 'DELETE FROM projects WHERE id = ?',
      args: [id],
    });

    if (result.rowsAffected === 0) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    return c.json({ success: true, data: { id } });
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
