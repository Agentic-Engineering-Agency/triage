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

// #5d: PUT /integrations/github auto-triggers generateWiki when the project
// was needs_auth/error. Mock the whole module so we can assert calls without
// firing the real pipeline. vi.hoisted() is required because vi.mock is
// hoisted above every `const` — the factory would otherwise close over an
// uninitialised variable.
const { generateWikiMock } = vi.hoisted(() => ({
  generateWikiMock: vi.fn(async () => ({
    projectId: '',
    documentsProcessed: 0,
    chunksCreated: 0,
    success: true,
  })),
}));
vi.mock('./wiki-rag', () => ({ generateWiki: generateWikiMock }));

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
    repo_default_branch TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    wiki_error TEXT,
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

  });

  describe('POST /projects/:id/integrations/linear/test', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const linearOkResponse = () => ({
      status: 200,
      json: async () => ({
        data: {
          viewer: { id: 'user-linear-id', name: 'Alice' },
          teams: {
            nodes: [
              { id: 'team-eng', name: 'Engineering', key: 'ENG' },
              { id: 'team-ops', name: 'Operations', key: 'OPS' },
            ],
          },
        },
      }),
    });

    it('returns teams preview and does NOT persist on valid key', async () => {
      fetchMock.mockResolvedValueOnce(linearOkResponse());
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'linear' },
          body: { apiKey: 'lin_api_valid' },
        }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(200);
      const body = res.body as {
        data: { valid: boolean; preview?: { teams: Array<{ id: string; name: string; key: string }> } };
      };
      expect(body.data.valid).toBe(true);
      expect(body.data.preview?.teams).toEqual([
        { id: 'team-eng', name: 'Engineering', key: 'ENG' },
        { id: 'team-ops', name: 'Operations', key: 'OPS' },
      ]);

      // Preview path must not write to project_integrations — the client
      // follows up with PUT after the user picks a team.
      const listRes = (await listIntegrationsRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect((listRes.body as { data: unknown[] }).data).toEqual([]);
    });

    it('PUT after preview persists with chosen teamId in meta', async () => {
      fetchMock.mockResolvedValueOnce(linearOkResponse());
      await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'linear' },
          body: { apiKey: 'lin_api_valid' },
        }),
      );
      const putRes = (await putIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'linear' },
          body: {
            apiKey: 'lin_api_valid',
            meta: { teamId: 'team-eng', teamName: 'Engineering', teamKey: 'ENG' },
          },
        }),
      )) as unknown as JsonRes;
      expect(putRes.status).toBe(200);
      const body = putRes.body as { data: { meta: Record<string, string> } };
      expect(body.data.meta).toEqual({
        teamId: 'team-eng',
        teamName: 'Engineering',
        teamKey: 'ENG',
      });

      const resolved = await resolveKey('linear', 'proj-owned');
      expect(resolved).toEqual({
        key: 'lin_api_valid',
        meta: { teamId: 'team-eng', teamName: 'Engineering', teamKey: 'ENG' },
        source: 'tenant',
      });
    });

    it('returns invalid_key on HTTP 401 and does not persist', async () => {
      fetchMock.mockResolvedValueOnce({ status: 401 });
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'linear' },
          body: { apiKey: 'lin_api_bad' },
        }),
      )) as unknown as JsonRes;
      const body = res.body as { data: { valid: boolean; reason?: string } };
      expect(body.data.valid).toBe(false);
      expect(body.data.reason).toBe('invalid_key');

      const listRes = (await listIntegrationsRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect((listRes.body as { data: unknown[] }).data).toEqual([]);
    });

    it('returns invalid_key on GraphQL AUTHENTICATION_ERROR in 200 body', async () => {
      // Linear returns 200 with `errors: [{ extensions: { code: "AUTHENTICATION_ERROR" } }]`
      // for bad tokens that parse as well-formed requests.
      fetchMock.mockResolvedValueOnce({
        status: 200,
        json: async () => ({
          errors: [
            {
              message: 'Authentication failed - invalid key',
              extensions: { code: 'AUTHENTICATION_ERROR' },
            },
          ],
        }),
      });
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'linear' },
          body: { apiKey: 'lin_api_malformed' },
        }),
      )) as unknown as JsonRes;
      const body = res.body as { data: { valid: boolean; reason?: string } };
      expect(body.data.valid).toBe(false);
      expect(body.data.reason).toBe('invalid_key');
    });

    it('returns network on fetch throw and does not persist', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'linear' },
          body: { apiKey: 'lin_api_any' },
        }),
      )) as unknown as JsonRes;
      const body = res.body as { data: { valid: boolean; reason?: string; message?: string } };
      expect(body.data.valid).toBe(false);
      expect(body.data.reason).toBe('network');

      const listRes = (await listIntegrationsRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect((listRes.body as { data: unknown[] }).data).toEqual([]);
    });

    it('sends the raw PAT without Bearer prefix (Linear contract)', async () => {
      fetchMock.mockResolvedValueOnce(linearOkResponse());
      await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'linear' },
          body: { apiKey: 'lin_api_raw' },
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.linear.app/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'lin_api_raw' }),
        }),
      );
    });
  });

  describe('POST /projects/:id/integrations/slack/test', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const slackAuthOk = () => ({
      status: 200,
      json: async () => ({ ok: true, team: 'Acme', user: 'triagebot' }),
    });
    const slackChannelsOk = () => ({
      status: 200,
      json: async () => ({
        ok: true,
        channels: [
          { id: 'C1', name: 'general', is_private: false },
          { id: 'C2', name: 'eng-private', is_private: true },
        ],
      }),
    });

    it('returns channels preview and does NOT persist on valid token', async () => {
      fetchMock.mockResolvedValueOnce(slackAuthOk()).mockResolvedValueOnce(slackChannelsOk());
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'slack' },
          body: { apiKey: 'xoxb-valid' },
        }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(200);
      const body = res.body as {
        data: {
          valid: boolean;
          preview?: { channels: Array<{ id: string; name: string; isPrivate: boolean }> };
        };
      };
      expect(body.data.valid).toBe(true);
      expect(body.data.preview?.channels).toEqual([
        { id: 'C1', name: 'general', isPrivate: false },
        { id: 'C2', name: 'eng-private', isPrivate: true },
      ]);

      const listRes = (await listIntegrationsRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect((listRes.body as { data: unknown[] }).data).toEqual([]);
    });

    it('returns invalid_key when auth.test responds ok:false invalid_auth', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 200,
        json: async () => ({ ok: false, error: 'invalid_auth' }),
      });
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'slack' },
          body: { apiKey: 'xoxb-bad' },
        }),
      )) as unknown as JsonRes;
      const body = res.body as { data: { valid: boolean; reason?: string } };
      expect(body.data.valid).toBe(false);
      expect(body.data.reason).toBe('invalid_key');
    });

    it('returns network on fetch throw', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'slack' },
          body: { apiKey: 'xoxb-any' },
        }),
      )) as unknown as JsonRes;
      const body = res.body as { data: { valid: boolean; reason?: string } };
      expect(body.data.valid).toBe(false);
      expect(body.data.reason).toBe('network');
    });

    it('returns valid=true with empty channels when token lacks channels:read (missing_scope)', async () => {
      // Common case: bot has chat:write only. auth.test succeeds; listing
      // channels fails with missing_scope. UI must still proceed so the user
      // can save with a manually typed channelId.
      fetchMock
        .mockResolvedValueOnce(slackAuthOk())
        .mockResolvedValueOnce({
          status: 200,
          json: async () => ({ ok: false, error: 'missing_scope' }),
        });
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'slack' },
          body: { apiKey: 'xoxb-minimal' },
        }),
      )) as unknown as JsonRes;
      const body = res.body as {
        data: { valid: boolean; preview?: { channels: unknown[] } };
      };
      expect(body.data.valid).toBe(true);
      expect(body.data.preview?.channels).toEqual([]);
    });

    it('PUT after preview persists with chosen channelId in meta', async () => {
      fetchMock.mockResolvedValueOnce(slackAuthOk()).mockResolvedValueOnce(slackChannelsOk());
      await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'slack' },
          body: { apiKey: 'xoxb-valid' },
        }),
      );
      const putRes = (await putIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'slack' },
          body: {
            apiKey: 'xoxb-valid',
            meta: { channelId: 'C1', channelName: 'general', teamName: 'Acme' },
          },
        }),
      )) as unknown as JsonRes;
      expect(putRes.status).toBe(200);
      const resolved = await resolveKey('slack', 'proj-owned');
      expect(resolved).toEqual({
        key: 'xoxb-valid',
        meta: { channelId: 'C1', channelName: 'general', teamName: 'Acme' },
        source: 'tenant',
      });
    });
  });

  describe('POST /projects/:id/integrations/resend/test', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('persists key + meta.fromEmail on 200 from /domains (no preview)', async () => {
      fetchMock.mockResolvedValueOnce({ status: 200, json: async () => ({ data: [] }) });
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'resend' },
          body: { apiKey: 're_valid', meta: { fromEmail: 'noreply@acme.io' } },
        }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(200);
      const body = res.body as {
        data: { valid: boolean; integration?: { status: string; meta: Record<string, string> } };
      };
      expect(body.data.valid).toBe(true);
      expect(body.data.integration?.status).toBe('active');
      expect(body.data.integration?.meta).toEqual({ fromEmail: 'noreply@acme.io' });

      const resolved = await resolveKey('resend', 'proj-owned');
      expect(resolved).toEqual({
        key: 're_valid',
        meta: { fromEmail: 'noreply@acme.io' },
        source: 'tenant',
      });
    });

    it('returns invalid_key on 401 and does not persist', async () => {
      fetchMock.mockResolvedValueOnce({ status: 401 });
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'resend' },
          body: { apiKey: 're_bad' },
        }),
      )) as unknown as JsonRes;
      const body = res.body as { data: { valid: boolean; reason?: string } };
      expect(body.data.valid).toBe(false);
      expect(body.data.reason).toBe('invalid_key');

      const listRes = (await listIntegrationsRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect((listRes.body as { data: unknown[] }).data).toEqual([]);
    });
  });

  describe('POST /projects/:id/integrations/github/test', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('validates PAT via /user only (no repos preview)', async () => {
      // #5d simplified the dispatcher: PUT /github owns repo-access
      // validation, so /test only answers "is this token real?". The
      // endpoint auto-persists (shortcut path) with empty meta, which
      // PUT will later overwrite with the real owner/repo.
      fetchMock.mockResolvedValueOnce({
        status: 200,
        json: async () => ({ id: 42, login: 'octocat' }),
      });
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'github' },
          body: { apiKey: 'ghp_valid' },
        }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(200);
      const body = res.body as { data: { valid: boolean; preview?: unknown } };
      expect(body.data.valid).toBe(true);
      expect(body.data.preview).toBeUndefined();
      // Only one fetch — the /user/repos call is gone.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/user',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer ghp_valid',
            'X-GitHub-Api-Version': '2022-11-28',
          }),
        }),
      );
    });

    it('returns invalid_key on 401 from /user', async () => {
      fetchMock.mockResolvedValueOnce({ status: 401 });
      const res = (await testIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'github' },
          body: { apiKey: 'ghp_bad' },
        }),
      )) as unknown as JsonRes;
      const body = res.body as { data: { valid: boolean; reason?: string } };
      expect(body.data.valid).toBe(false);
      expect(body.data.reason).toBe('invalid_key');
    });
  });

  describe('PUT /projects/:id/integrations/github — repo-access validation', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      generateWikiMock.mockClear();
      // Seed a GitHub-shaped repo_url on the owned project for these tests;
      // the top-level seedDb leaves repo_url empty for the broader suite.
      await client.execute({
        sql: `UPDATE projects SET repo_url = ?, repo_default_branch = ?, status = ?
              WHERE id = ?`,
        args: ['https://github.com/octocat/hello', 'main', 'pending', 'proj-owned'],
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('on 200 probe: auto-sets meta from repo_url, persists, marks tested', async () => {
      fetchMock.mockResolvedValueOnce({ status: 200, json: async () => ({}) });
      const res = (await putIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'github' },
          body: { apiKey: 'ghp_valid' },
        }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(200);
      const body = res.body as {
        data: { provider: string; status: string; meta: Record<string, string> };
      };
      expect(body.data.provider).toBe('github');
      expect(body.data.meta).toEqual({
        owner: 'octocat',
        repo: 'hello',
        repoFullName: 'octocat/hello',
      });

      const resolved = await resolveKey('github', 'proj-owned');
      expect(resolved.key).toBe('ghp_valid');
      expect(resolved.source).toBe('tenant');
      expect(resolved.meta).toEqual({
        owner: 'octocat',
        repo: 'hello',
        repoFullName: 'octocat/hello',
      });

      // Probe hit the correct URL with Bearer auth.
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/octocat/hello',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer ghp_valid' }),
        }),
      );
    });

    it('on 401 probe: REPO_ACCESS_DENIED and does NOT persist', async () => {
      fetchMock.mockResolvedValueOnce({ status: 401, json: async () => ({}) });
      const res = (await putIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'github' },
          body: { apiKey: 'ghp_no_scope' },
        }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(400);
      const body = res.body as { error: { code: string; message: string } };
      expect(body.error.code).toBe('REPO_ACCESS_DENIED');
      expect(body.error.message).toMatch(/octocat\/hello/);

      const listRes = (await listIntegrationsRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect((listRes.body as { data: unknown[] }).data).toEqual([]);
    });

    it('on 404 probe: REPO_NOT_FOUND_WITH_TOKEN and does NOT persist', async () => {
      fetchMock.mockResolvedValueOnce({ status: 404, json: async () => ({}) });
      const res = (await putIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'github' },
          body: { apiKey: 'ghp_wrong_account' },
        }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'REPO_NOT_FOUND_WITH_TOKEN',
      );
    });

    it('rejects when project repo is not on GitHub', async () => {
      await client.execute({
        sql: `UPDATE projects SET repo_url = ? WHERE id = ?`,
        args: ['https://gitlab.com/foo/bar', 'proj-owned'],
      });
      const res = (await putIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'github' },
          body: { apiKey: 'ghp_irrelevant' },
        }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'PROJECT_REPO_NOT_GITHUB',
      );
      // Probe must NOT have been called when the repo fails local parse.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("flips status from needs_auth → pending and triggers generateWiki", async () => {
      await client.execute({
        sql: `UPDATE projects SET status = 'needs_auth', wiki_error = ? WHERE id = ?`,
        args: ['Private repo — connect GitHub', 'proj-owned'],
      });
      fetchMock.mockResolvedValueOnce({ status: 200, json: async () => ({}) });
      const res = (await putIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'github' },
          body: { apiKey: 'ghp_real' },
        }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(200);

      const row = (
        await client.execute('SELECT status, wiki_error FROM projects WHERE id = ?', [
          'proj-owned',
        ])
      ).rows[0];
      expect(row.status).toBe('pending');
      expect(row.wiki_error).toBeNull();

      expect(generateWikiMock).toHaveBeenCalledTimes(1);
      expect(generateWikiMock).toHaveBeenCalledWith(
        'proj-owned',
        'https://github.com/octocat/hello',
        'main',
      );
    });

    it('does NOT trigger generateWiki when status was already pending/ready', async () => {
      fetchMock.mockResolvedValueOnce({ status: 200, json: async () => ({}) });
      await putIntegrationRoute.handler(
        makeCtx({
          params: { projectId: 'proj-owned', provider: 'github' },
          body: { apiKey: 'ghp_valid' },
        }),
      );
      expect(generateWikiMock).not.toHaveBeenCalled();
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
      expect(resolved).toEqual({ key: 'sk-tenant-real', meta: {}, source: 'tenant' });
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
      expect(resolved).toEqual({ key: 'sk-env-fallback', meta: {}, source: 'env' });
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
