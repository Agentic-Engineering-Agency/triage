import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import {
  __setClientForTests,
  getWebhookSecret,
  setWebhookSecret,
  LINEAR_PROVIDER,
} from './webhook-secrets';

async function freshMemoryDb() {
  const client = createClient({ url: ':memory:' });
  await client.execute(`
    CREATE TABLE webhook_secrets (
      provider TEXT PRIMARY KEY,
      webhook_id TEXT,
      secret TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  __setClientForTests(client);
  return client;
}

describe('webhook-secrets', () => {
  beforeEach(async () => {
    await freshMemoryDb();
  });

  it('returns null when no secret has been stored', async () => {
    const got = await getWebhookSecret(LINEAR_PROVIDER);
    expect(got).toBeNull();
  });

  it('stores and retrieves a secret', async () => {
    await setWebhookSecret(LINEAR_PROVIDER, 's3cr3t', 'wh_123');
    const got = await getWebhookSecret(LINEAR_PROVIDER);
    expect(got).toBe('s3cr3t');
  });

  it('upserts: a second write replaces the first', async () => {
    await setWebhookSecret(LINEAR_PROVIDER, 'old', 'wh_old');
    await setWebhookSecret(LINEAR_PROVIDER, 'new', 'wh_new');
    const got = await getWebhookSecret(LINEAR_PROVIDER);
    expect(got).toBe('new');
  });

  it('isolates secrets by provider', async () => {
    await setWebhookSecret('linear', 'a', null);
    await setWebhookSecret('github', 'b', null);
    expect(await getWebhookSecret('linear')).toBe('a');
    expect(await getWebhookSecret('github')).toBe('b');
    expect(await getWebhookSecret('slack')).toBeNull();
  });
});
