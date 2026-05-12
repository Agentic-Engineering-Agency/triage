import { createClient, type Client } from '@libsql/client';

/**
 * Storage for webhook signing secrets — keyed by (provider, project_id).
 *
 * The composite PK lets each tenant register its own webhook secret without
 * stomping on neighbors. Callers that don't yet have a project context fall
 * back to the `GLOBAL_PROJECT_ID` sentinel — same row the legacy single-PK
 * schema was storing, so the upgrade path keeps working until the webhook
 * setup endpoint goes multi-tenant.
 *
 * The schema itself ships via `init-db.mjs` (fresh installs get the composite
 * PK; existing databases run a one-shot in-place migration that copies the
 * single row under the `_global_` sentinel).
 */

export const GLOBAL_PROJECT_ID = '_global_';
export const LINEAR_PROVIDER = 'linear';

let cachedClient: Client | null = null;

function getClient(): Client {
  if (cachedClient) return cachedClient;
  const url = process.env.LIBSQL_URL || 'http://libsql:8080';
  cachedClient = createClient({ url });
  return cachedClient;
}

// Exposed for tests to inject an in-memory client.
export function __setClientForTests(client: Client | null): void {
  cachedClient = client;
}

export async function setWebhookSecret(
  provider: string,
  secret: string,
  webhookId: string | null,
  projectId: string = GLOBAL_PROJECT_ID,
): Promise<void> {
  const now = Date.now();
  await getClient().execute({
    sql: `INSERT INTO webhook_secrets
            (provider, project_id, webhook_id, secret, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(provider, project_id) DO UPDATE SET
            webhook_id = excluded.webhook_id,
            secret = excluded.secret,
            updated_at = excluded.updated_at`,
    args: [provider, projectId, webhookId, secret, now, now],
  });
}

export async function getWebhookSecret(
  provider: string,
  projectId: string = GLOBAL_PROJECT_ID,
): Promise<string | null> {
  const r = await getClient().execute({
    sql: `SELECT secret FROM webhook_secrets
          WHERE provider = ? AND project_id = ?
          LIMIT 1`,
    args: [provider, projectId],
  });
  const row = r.rows[0];
  return row ? String(row.secret) : null;
}
