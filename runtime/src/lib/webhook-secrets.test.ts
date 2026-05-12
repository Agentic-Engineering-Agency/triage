import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import {
  __setClientForTests,
  getWebhookSecret,
  setWebhookSecret,
  GLOBAL_PROJECT_ID,
  LINEAR_PROVIDER,
} from './webhook-secrets';

async function freshMemoryDb() {
  const client = createClient({ url: ':memory:' });
  await client.execute(`
    CREATE TABLE webhook_secrets (
      provider TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT '_global_',
      webhook_id TEXT,
      secret TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (provider, project_id)
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

  it('stores and retrieves a secret (global default scope)', async () => {
    await setWebhookSecret(LINEAR_PROVIDER, 's3cr3t', 'wh_123');
    const got = await getWebhookSecret(LINEAR_PROVIDER);
    expect(got).toBe('s3cr3t');
  });

  it('upserts on (provider, project_id): a second write replaces the first', async () => {
    await setWebhookSecret(LINEAR_PROVIDER, 'old', 'wh_old');
    await setWebhookSecret(LINEAR_PROVIDER, 'new', 'wh_new');
    const got = await getWebhookSecret(LINEAR_PROVIDER);
    expect(got).toBe('new');
  });

  it('isolates secrets by provider (global scope)', async () => {
    await setWebhookSecret('linear', 'a', null);
    await setWebhookSecret('github', 'b', null);
    expect(await getWebhookSecret('linear')).toBe('a');
    expect(await getWebhookSecret('github')).toBe('b');
    expect(await getWebhookSecret('slack')).toBeNull();
  });

  it('isolates secrets by project_id within the same provider', async () => {
    await setWebhookSecret(LINEAR_PROVIDER, 'global-secret', 'wh_global');
    await setWebhookSecret(LINEAR_PROVIDER, 'proj-a-secret', 'wh_a', 'proj-a');
    await setWebhookSecret(LINEAR_PROVIDER, 'proj-b-secret', 'wh_b', 'proj-b');

    expect(await getWebhookSecret(LINEAR_PROVIDER)).toBe('global-secret');
    expect(await getWebhookSecret(LINEAR_PROVIDER, GLOBAL_PROJECT_ID)).toBe('global-secret');
    expect(await getWebhookSecret(LINEAR_PROVIDER, 'proj-a')).toBe('proj-a-secret');
    expect(await getWebhookSecret(LINEAR_PROVIDER, 'proj-b')).toBe('proj-b-secret');
    expect(await getWebhookSecret(LINEAR_PROVIDER, 'proj-unknown')).toBeNull();
  });

  it('global secret does not leak to projects that have not registered their own', async () => {
    await setWebhookSecret(LINEAR_PROVIDER, 'global-only', null);
    // Project-scoped lookup misses — does NOT fall back to the global row.
    // Callers must opt into the global scope explicitly.
    expect(await getWebhookSecret(LINEAR_PROVIDER, 'proj-x')).toBeNull();
  });

  it('updating a project-scoped row does not affect the global row', async () => {
    await setWebhookSecret(LINEAR_PROVIDER, 'global', 'wh_g');
    await setWebhookSecret(LINEAR_PROVIDER, 'proj-a-v1', 'wh_a', 'proj-a');
    await setWebhookSecret(LINEAR_PROVIDER, 'proj-a-v2', 'wh_a2', 'proj-a');
    expect(await getWebhookSecret(LINEAR_PROVIDER)).toBe('global');
    expect(await getWebhookSecret(LINEAR_PROVIDER, 'proj-a')).toBe('proj-a-v2');
  });
});
