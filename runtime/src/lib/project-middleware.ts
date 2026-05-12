/**
 * Project scoping middleware — validates projectId and ensures user can access it.
 *
 * This middleware is applied to all /projects/:projectId/* routes.
 * It:
 * 1. Extracts projectId from the URL parameter
 * 2. Verifies the project exists
 * 3. (Future) Validates user owns the project via auth context
 * 4. Attaches projectId to the request context for use in handlers
 */
import { createClient } from '@libsql/client';
import type { Context, Next } from 'hono';

function getDb() {
  return createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
}

/**
 * Middleware to validate and attach projectId to context
 * Usage: app.use('/projects/:projectId/*', projectScopingMiddleware)
 */
export async function projectScopingMiddleware(c: Context, next: Next) {
  const projectId = c.req.param('projectId');

  if (!projectId) {
    return c.json({ success: false, error: { code: 'MISSING_PROJECT_ID', message: 'projectId is required' } }, 400);
  }

  // Verify project exists
  const db = getDb();
  const result = await db.execute('SELECT id FROM projects WHERE id = ? LIMIT 1', [projectId]);

  if (result.rows.length === 0) {
    return c.json({ success: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } }, 404);
  }

  // Attach projectId to context for use in route handlers
  c.set('projectId', projectId);

  await next();
}

/**
 * Helper to get projectId from context (must be called after projectScopingMiddleware)
 */
export function getProjectIdFromContext(c: Context): string {
  return c.get('projectId') as string;
}
