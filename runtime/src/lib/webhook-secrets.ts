import { createClient, type Client } from '@libsql/client';

/**
 * Storage for webhook signing secrets.
 *
 * Keyed by provider (currently just `linear`). When multi-tenant lands
 * (#3 in the handoff), this moves to a per-project table with envelope
 * encryption. Until then, a single row is enough to fail closed on
 * unsigned webhooks instead of leaving the endpoint open.
 */

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
): Promise<void> {
  const now = Date.now();
  await getClient().execute({
    sql: `INSERT INTO webhook_secrets (provider, webhook_id, secret, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(provider) DO UPDATE SET
            webhook_id = excluded.webhook_id,
            secret = excluded.secret,
            updated_at = excluded.updated_at`,
    args: [provider, webhookId, secret, now, now],
  });
}

export async function getWebhookSecret(provider: string): Promise<string | null> {
  const r = await getClient().execute({
    sql: `SELECT secret FROM webhook_secrets WHERE provider = ? LIMIT 1`,
    args: [provider],
  });
  const row = r.rows[0];
  return row ? String(row.secret) : null;
}

export const LINEAR_PROVIDER = 'linear';
