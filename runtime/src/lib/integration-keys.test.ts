import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { randomBytes } from 'node:crypto';
import {
  __setClientForTests,
  __clearCacheForTests,
  setIntegrationKey,
  getIntegrationKey,
  listIntegrations,
  deleteIntegrationKey,
  markTested,
} from './integration-keys';

async function freshMemoryDb() {
  const client = createClient({ url: ':memory:' });
  await client.execute(`
    CREATE TABLE project_integrations (
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      encrypted_key BLOB NOT NULL,
      meta TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      last_tested_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, provider)
    )
  `);
  return client;
}

const PROJECT_A = 'proj_a';
const PROJECT_B = 'proj_b';

describe('integration-keys', () => {
  let masterKeyB64: string;
  let originalMasterKey: string | undefined;

  beforeEach(async () => {
    masterKeyB64 = randomBytes(32).toString('base64');
    originalMasterKey = process.env.APP_MASTER_KEY;
    process.env.APP_MASTER_KEY = masterKeyB64;
    const client = await freshMemoryDb();
    __setClientForTests(client);
    __clearCacheForTests();
  });

  afterEach(() => {
    __setClientForTests(null);
    __clearCacheForTests();
    if (originalMasterKey === undefined) delete process.env.APP_MASTER_KEY;
    else process.env.APP_MASTER_KEY = originalMasterKey;
  });

  describe('set → get round trip', () => {
    it('stores and retrieves a key with default meta', async () => {
      const set = await setIntegrationKey(PROJECT_A, 'linear', 'sk-linear-xxx');
      expect(set).toEqual({ ok: true });

      const got = await getIntegrationKey(PROJECT_A, 'linear');
      expect(got.ok).toBe(true);
      if (!got.ok) return;
      expect(got.plaintext).toBe('sk-linear-xxx');
      expect(got.meta).toEqual({});
      expect(got.status).toBe('active');
      expect(got.lastTestedAt).toBeNull();
    });

    it('round-trips meta fields', async () => {
      await setIntegrationKey(PROJECT_A, 'linear', 'key', { teamId: 'TEAM-1', orgName: 'Acme' });
      const got = await getIntegrationKey(PROJECT_A, 'linear');
      expect(got.ok).toBe(true);
      if (got.ok) expect(got.meta).toEqual({ teamId: 'TEAM-1', orgName: 'Acme' });
    });

    it('UPSERT on same (project, provider) replaces key and resets last_tested_at', async () => {
      await setIntegrationKey(PROJECT_A, 'linear', 'old-key');
      await markTested(PROJECT_A, 'linear', true);
      const beforeReplace = await getIntegrationKey(PROJECT_A, 'linear');
      expect(beforeReplace.ok).toBe(true);
      if (beforeReplace.ok) expect(beforeReplace.lastTestedAt).not.toBeNull();

      __clearCacheForTests();
      await setIntegrationKey(PROJECT_A, 'linear', 'new-key');
      const got = await getIntegrationKey(PROJECT_A, 'linear');
      expect(got.ok).toBe(true);
      if (got.ok) {
        expect(got.plaintext).toBe('new-key');
        expect(got.lastTestedAt).toBeNull();
      }
    });
  });

  describe('get failures', () => {
    it('missing row → not_found', async () => {
      const got = await getIntegrationKey(PROJECT_A, 'linear');
      expect(got).toEqual({ ok: false, reason: 'not_found' });
    });

    it('wrong master key (rotated) → decrypt_failed', async () => {
      await setIntegrationKey(PROJECT_A, 'linear', 'sk-xxx');
      __clearCacheForTests();
      process.env.APP_MASTER_KEY = randomBytes(32).toString('base64');
      const got = await getIntegrationKey(PROJECT_A, 'linear');
      expect(got).toEqual({ ok: false, reason: 'decrypt_failed' });
    });

    it('missing master key → master_key_missing', async () => {
      await setIntegrationKey(PROJECT_A, 'linear', 'sk-xxx');
      __clearCacheForTests();
      delete process.env.APP_MASTER_KEY;
      const got = await getIntegrationKey(PROJECT_A, 'linear');
      expect(got).toEqual({ ok: false, reason: 'master_key_missing' });
    });

    it('tampered ciphertext → decrypt_failed', async () => {
      await setIntegrationKey(PROJECT_A, 'linear', 'sk-xxx');
      __clearCacheForTests();
      // Flip the last byte of encrypted_key directly in the DB
      const client = createClient({ url: ':memory:' });
      __setClientForTests(client);
      // Re-setup the DB with a tampered row
      await client.execute(`
        CREATE TABLE project_integrations (
          project_id TEXT NOT NULL, provider TEXT NOT NULL, encrypted_key BLOB NOT NULL,
          meta TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active',
          last_tested_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          PRIMARY KEY (project_id, provider)
        )
      `);
      await setIntegrationKey(PROJECT_A, 'linear', 'sk-xxx');
      __clearCacheForTests();
      const r = await client.execute({
        sql: 'SELECT encrypted_key FROM project_integrations WHERE project_id=? AND provider=?',
        args: [PROJECT_A, 'linear'],
      });
      const blob = r.rows[0].encrypted_key as Uint8Array;
      const tampered = Buffer.from(blob);
      tampered[tampered.length - 1] ^= 0xff;
      await client.execute({
        sql: 'UPDATE project_integrations SET encrypted_key=? WHERE project_id=? AND provider=?',
        args: [tampered, PROJECT_A, 'linear'],
      });
      const got = await getIntegrationKey(PROJECT_A, 'linear');
      expect(got).toEqual({ ok: false, reason: 'decrypt_failed' });
    });
  });

  describe('set failures', () => {
    it('missing master key → master_key_missing', async () => {
      delete process.env.APP_MASTER_KEY;
      const res = await setIntegrationKey(PROJECT_A, 'linear', 'sk-xxx');
      expect(res).toEqual({ ok: false, reason: 'master_key_missing' });
    });
  });

  describe('listIntegrations', () => {
    it('returns summaries without plaintext or ciphertext', async () => {
      await setIntegrationKey(PROJECT_A, 'linear', 'sk-lin', { teamId: 'T' });
      await setIntegrationKey(PROJECT_A, 'resend', 'sk-res', { fromDomain: 'x.lat' });
      await setIntegrationKey(PROJECT_B, 'github', 'ghp_zzz');

      const summaries = await listIntegrations(PROJECT_A);
      expect(summaries).toHaveLength(2);
      const providers = summaries.map((s) => s.provider).sort();
      expect(providers).toEqual(['linear', 'resend']);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serialized = JSON.stringify(summaries);
      expect(serialized).not.toContain('sk-lin');
      expect(serialized).not.toContain('sk-res');

      for (const s of summaries) {
        expect(s).not.toHaveProperty('plaintext');
        expect(s).not.toHaveProperty('encryptedKey');
      }
    });

    it('isolates between projects', async () => {
      await setIntegrationKey(PROJECT_A, 'linear', 'a-key');
      await setIntegrationKey(PROJECT_B, 'linear', 'b-key');
      expect((await listIntegrations(PROJECT_A)).map((s) => s.provider)).toEqual(['linear']);
      expect((await listIntegrations(PROJECT_B)).map((s) => s.provider)).toEqual(['linear']);
    });

    it('empty for project with no keys', async () => {
      expect(await listIntegrations(PROJECT_A)).toEqual([]);
    });
  });

  describe('deleteIntegrationKey', () => {
    it('removes the row and evicts cache', async () => {
      await setIntegrationKey(PROJECT_A, 'linear', 'sk-xxx');
      await getIntegrationKey(PROJECT_A, 'linear'); // populate cache
      await deleteIntegrationKey(PROJECT_A, 'linear');
      const got = await getIntegrationKey(PROJECT_A, 'linear');
      expect(got).toEqual({ ok: false, reason: 'not_found' });
    });

    it('is a no-op when row does not exist', async () => {
      await expect(deleteIntegrationKey(PROJECT_A, 'linear')).resolves.toBeUndefined();
    });
  });

  describe('markTested', () => {
    it('updates status and lastTestedAt, evicts cache', async () => {
      await setIntegrationKey(PROJECT_A, 'linear', 'sk-xxx');
      await getIntegrationKey(PROJECT_A, 'linear'); // cache

      await markTested(PROJECT_A, 'linear', true);
      const got = await getIntegrationKey(PROJECT_A, 'linear');
      expect(got.ok).toBe(true);
      if (got.ok) {
        expect(got.status).toBe('active');
        expect(got.lastTestedAt).toBeInstanceOf(Date);
      }
    });

    it('failure flips status to invalid', async () => {
      await setIntegrationKey(PROJECT_A, 'linear', 'sk-xxx');
      await markTested(PROJECT_A, 'linear', false);
      const got = await getIntegrationKey(PROJECT_A, 'linear');
      expect(got.ok).toBe(true);
      if (got.ok) expect(got.status).toBe('invalid');
    });
  });

  describe('cache', () => {
    it('second get hits the cache (no DB query)', async () => {
      await setIntegrationKey(PROJECT_A, 'linear', 'sk-xxx');

      // First get — populates cache
      await getIntegrationKey(PROJECT_A, 'linear');

      // Swap the client for one that would throw if hit
      const throwingClient = {
        execute: vi.fn(() => {
          throw new Error('should not hit DB');
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      __setClientForTests(throwingClient as any);

      const got = await getIntegrationKey(PROJECT_A, 'linear');
      expect(got.ok).toBe(true);
      expect(throwingClient.execute).not.toHaveBeenCalled();
    });

    it('TTL expiry forces re-query', async () => {
      vi.useFakeTimers();
      try {
        await setIntegrationKey(PROJECT_A, 'linear', 'sk-xxx');
        await getIntegrationKey(PROJECT_A, 'linear');
        vi.advanceTimersByTime(61_000);
        // Should re-query the DB — swap to throwing client to prove it tries
        const throwingClient = {
          execute: vi.fn(() => {
            throw new Error('fell through to DB');
          }),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        __setClientForTests(throwingClient as any);
        await expect(getIntegrationKey(PROJECT_A, 'linear')).rejects.toThrow('fell through');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
