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
