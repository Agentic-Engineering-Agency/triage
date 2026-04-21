/**
 * Unit tests for integration-routes.ts — the encrypted per-tenant key path.
 *
 * Uses `:memory:` libsql shared across integration-routes (ownership) and
 * integration-keys (encryption). No mocks of the storage layer — that way a
 * round-trip test can insert, decrypt via resolveKey, and assert `source=tenant`.
 *
 * `fetch` is stubbed for the openrouter test endpoint only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import {
  __setClientForTests as setRoutesClient,
  listIntegrationsRoute,
  putIntegrationRoute,
  deleteIntegrationRoute,
  testIntegrationRoute,
} from './integration-routes';
import {
  __setClientForTests as setKeysClient,
  __clearCacheForTests,
} from './integration-keys';
import { __setClientForTests as setAuthClient } from './auth-helpers';
import { __clearLogCacheForTests, resolveKey } from './tenant-keys';

type JsonRes = { status: number; body: unknown };

interface CtxInit {
  params?: Record<string, string>;
  body?: unknown;
  cookie?: string;
}

function makeCtx(init: CtxInit = {}): Context {
  const params = init.params ?? {};
  const cookie = init.cookie ?? 'better-auth.session_token=valid-token.sig';
  const body = init.body;
  return {
    req: {
      param: (name: string) => params[name],
      header: (name: string) => (name === 'cookie' ? cookie : undefined),
      json: async () => body,
    },
    json: (data: unknown, status = 200) => ({ status, body: data } as JsonRes),
  } as unknown as Context;
}

async function seedDb(): Promise<Client> {
  const client = createClient({ url: ':memory:' });
  await client.execute(`CREATE TABLE auth_session (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await client.execute(`CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    repo_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await client.execute(`CREATE TABLE project_integrations (
    project_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    encrypted_key BLOB NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    last_tested_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, provider)
  )`);
  const now = Date.now();
  await client.execute({
    sql: 'INSERT INTO auth_session (id, user_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: ['s1', 'user-owner', 'valid-token', now + 1_000_000, now, now],
  });
  await client.execute({
    sql: 'INSERT INTO auth_session (id, user_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: ['s2', 'user-other', 'other-token', now + 1_000_000, now, now],
  });
  await client.execute({
    sql: 'INSERT INTO projects (id, user_id, name, repo_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: ['proj-owned', 'user-owner', 'mine', '', now, now],
  });
  await client.execute({
    sql: 'INSERT INTO projects (id, user_id, name, repo_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: ['proj-foreign', 'user-other', 'not-mine', '', now, now],
  });
  return client;
}

describe('integration-routes', () => {
  let originalMasterKey: string | undefined;
  let client: Client;

  beforeEach(async () => {
    originalMasterKey = process.env.APP_MASTER_KEY;
    process.env.APP_MASTER_KEY = randomBytes(32).toString('base64');
    client = await seedDb();
    setRoutesClient(client);
    setKeysClient(client);
    setAuthClient(client);
    __clearCacheForTests();
    __clearLogCacheForTests();
  });

  afterEach(() => {
    setRoutesClient(null);
    setKeysClient(null);
    setAuthClient(null);
    __clearCacheForTests();
    __clearLogCacheForTests();
    if (originalMasterKey === undefined) delete process.env.APP_MASTER_KEY;
    else process.env.APP_MASTER_KEY = originalMasterKey;
  });

  describe('auth + ownership', () => {
    it('returns 401 when no session cookie is present', async () => {
      const res = (await listIntegrationsRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' }, cookie: '' }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(401);
    });

    it('returns 404 when the caller does not own the project', async () => {
      const res = (await listIntegrationsRoute.handler(
        makeCtx({ params: { projectId: 'proj-foreign' } }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(404);
    });

    it('returns 404 when the project does not exist (no existence leak)', async () => {
      const res = (await listIntegrationsRoute.handler(
        makeCtx({ params: { projectId: 'ghost' } }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(404);
    });
  });

  describe('GET /projects/:id/integrations', () => {
    it('returns an empty array for a project with no keys', async () => {
      const res = (await listIntegrationsRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(200);
      expect((res.body as { success: boolean; data: unknown[] }).data).toEqual([]);
    });
  });

  describe('PUT /projects/:id/integrations/:provider', () => {
    it('rejects unknown providers with 400', async () => {
      const res = (await putIntegrationRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned', provider: 'stripe' }, body: { apiKey: 'x' } }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe('INVALID_PROVIDER');
    });

    it('rejects empty apiKey with 400', async () => {
      const res = (await putIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'openrouter' },
          body: { apiKey: '' },
        }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION');
    });

    it('encrypts and stores a key, returns summary without plaintext', async () => {
      const res = (await putIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'openrouter' },
          body: { apiKey: 'sk-or-xxx', meta: { label: 'dev' } },
        }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(200);
      const body = res.body as { success: boolean; data: { provider: string; status: string; meta: Record<string, string> } };
      expect(body.data.provider).toBe('openrouter');
      expect(body.data.status).toBe('active');
      expect(body.data.meta).toEqual({ label: 'dev' });
      expect(JSON.stringify(res.body)).not.toContain('sk-or-xxx');
    });
  });

  describe('DELETE /projects/:id/integrations/:provider', () => {
    it('deletes a stored key and clears the cache', async () => {
      await putIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'openrouter' },
          body: { apiKey: 'sk-or-xxx' },
        }),
      );

      const delRes = (await deleteIntegrationRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned', provider: 'openrouter' } }),
      )) as unknown as JsonRes;
      expect(delRes.status).toBe(200);

      const listRes = (await listIntegrationsRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect((listRes.body as { data: unknown[] }).data).toEqual([]);
    });
  });

  describe('POST /projects/:id/integrations/openrouter/test', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('persists the key and marks tested on 200 from OpenRouter', async () => {
      fetchMock.mockResolvedValueOnce({ status: 200 });
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'openrouter' },
          body: { apiKey: 'sk-or-valid' },
        }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(200);
      const body = res.body as { success: boolean; data: { valid: boolean; integration: { status: string; lastTestedAt: string | null } } };
      expect(body.data.valid).toBe(true);
      expect(body.data.integration.status).toBe('active');
      expect(body.data.integration.lastTestedAt).not.toBeNull();
    });

    it('does not persist when OpenRouter returns 401', async () => {
      fetchMock.mockResolvedValueOnce({ status: 401 });
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'openrouter' },
          body: { apiKey: 'sk-or-invalid' },
        }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(200);
      const body = res.body as { data: { valid: boolean; reason?: string } };
      expect(body.data.valid).toBe(false);
      expect(body.data.reason).toBe('invalid_key');

      const listRes = (await listIntegrationsRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect((listRes.body as { data: unknown[] }).data).toEqual([]);
    });

    it('does not persist on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'openrouter' },
          body: { apiKey: 'sk-or-any' },
        }),
      )) as unknown as JsonRes;
      const body = res.body as { data: { valid: boolean; reason?: string } };
      expect(body.data.valid).toBe(false);
      expect(body.data.reason).toBe('network');

      const listRes = (await listIntegrationsRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect((listRes.body as { data: unknown[] }).data).toEqual([]);
    });

    it('returns not_implemented for other providers', async () => {
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'linear' },
          body: { apiKey: 'lin_xxx' },
        }),
      )) as unknown as JsonRes;
      const body = res.body as { data: { valid: boolean; reason?: string } };
      expect(body.data.valid).toBe(false);
      expect(body.data.reason).toBe('not_implemented');
    });
  });

  describe('round-trip encrypt → resolveKey', () => {
    it('after PUT openrouter, resolveKey returns source=tenant with the plaintext', async () => {
      await putIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'openrouter' },
          body: { apiKey: 'sk-tenant-real' },
        }),
      );

      const resolved = await resolveKey('openrouter', 'proj-owned');
      expect(resolved).toEqual({ key: 'sk-tenant-real', source: 'tenant' });
    });

    it('after DELETE, resolveKey falls back to env', async () => {
      await putIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'openrouter' },
          body: { apiKey: 'sk-tenant' },
        }),
      );
      await deleteIntegrationRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned', provider: 'openrouter' } }),
      );

      process.env.OPENROUTER_API_KEY = 'sk-env-fallback';
      const resolved = await resolveKey('openrouter', 'proj-owned');
      expect(resolved).toEqual({ key: 'sk-env-fallback', source: 'env' });
    });

    it('isolates keys between projects', async () => {
      // user-other owns proj-foreign. Seed a key there directly through the
      // integration-keys helper (bypassing auth) to keep the test focused on
      // isolation rather than the cross-tenant auth path.
      const { setIntegrationKey } = await import('./integration-keys');
      await setIntegrationKey('proj-foreign', 'openrouter', 'sk-foreign');

      await putIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'openrouter' },
          body: { apiKey: 'sk-owned' },
        }),
      );

      const resolvedA = await resolveKey('openrouter', 'proj-owned');
      const resolvedB = await resolveKey('openrouter', 'proj-foreign');
      expect(resolvedA.key).toBe('sk-owned');
      expect(resolvedB.key).toBe('sk-foreign');
    });
  });
});
