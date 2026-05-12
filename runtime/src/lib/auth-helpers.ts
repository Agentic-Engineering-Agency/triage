import type { Context } from 'hono';
import { createClient, type Client } from '@libsql/client';

/**
 * Shared Better Auth session helpers.
 *
 * Cookie format: `better-auth.session_token=<token>.<signature>` (URL-encoded).
 * The signature suffix is stripped — only the token itself is the lookup key
 * against `auth_session.token`.
 *
 * Prior to this helper, the extraction + userId lookup was copy-pasted across
 * `project-routes.ts`, `mastra/index.ts` (memory routes). Consolidated here so
 * ownership checks on new per-project routes (#5 integrations) stay in one
 * place.
 */

let cachedClient: Client | null = null;

function getClient(): Client {
  if (cachedClient) return cachedClient;
  cachedClient = createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
  return cachedClient;
}

export function __setClientForTests(client: Client | null): void {
  cachedClient = client;
}

/**
 * Parse the raw `Cookie` header and return the Better Auth session token
 * (without the `.<signature>` suffix). Returns null if the cookie is missing
 * or unparseable.
 */
export function extractSessionToken(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/better-auth\.session_token=([^;]+)/);
  if (!match) return null;
  const raw = decodeURIComponent(match[1]);
  const dotIndex = raw.indexOf('.');
  return dotIndex >= 0 ? raw.slice(0, dotIndex) : raw;
}

/**
 * Resolve the user id from the incoming request's session cookie. Returns
 * null when no cookie is present or the token doesn't map to an active
 * session. Callers should treat null as 401.
 */
export async function getUserIdFromRequest(c: Context): Promise<string | null> {
  const token = extractSessionToken(c.req.header('cookie'));
  if (!token) return null;
  const r = await getClient().execute({
    sql: 'SELECT user_id FROM auth_session WHERE token = ? LIMIT 1',
    args: [token],
  });
  const userId = r.rows[0]?.user_id;
  return userId ? String(userId) : null;
}

export type OwnershipResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 404 };

/**
 * Ownership gate for any `/projects/:projectId/*` route. Returns:
 *   - 401 when the request has no valid session
 *   - 404 when the project doesn't exist OR belongs to a different user
 *     (uniform 404 so we don't leak existence to non-owners)
 *
 * Use `authErrorResponse(c, result.status)` to produce the matching JSON
 * error body.
 */
export async function assertProjectOwnership(
  c: Context,
  projectId: string,
): Promise<OwnershipResult> {
  const userId = await getUserIdFromRequest(c);
  if (!userId) return { ok: false, status: 401 };
  const r = await getClient().execute({
    sql: 'SELECT 1 FROM projects WHERE id = ? AND user_id = ? LIMIT 1',
    args: [projectId, userId],
  });
  if (r.rows.length === 0) return { ok: false, status: 404 };
  return { ok: true, userId };
}

export function authErrorResponse(c: Context, status: 401 | 404) {
  return c.json(
    {
      success: false,
      error: {
        code: status === 401 ? 'UNAUTHORIZED' : 'NOT_FOUND',
        message: status === 401 ? 'No valid session' : 'Project not found',
      },
    },
    status,
  );
}
