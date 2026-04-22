/**
 * Unit tests for scoped-routes.ts — the project-scoped `/linear/*` + `/wiki/*`
 * endpoints after the multi-tenant flip.
 *
 * Two independent axes under test:
 *   1. Ownership gate: unauthenticated → 401, cross-tenant → 404.
 *   2. Credential resolution: tenant row wins; falls back to env + legacy
 *      `projects.linear_team_id` when no tenant row; surfaces NO_LINEAR_CONFIG
 *      when neither source has usable data.
 *
 * Uses `:memory:` libsql and a stubbed @linear/sdk so we can observe which
 * apiKey + teamId reached the SDK on each call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomBytes } from 'node:crypto';
import type { Context } from 'hono';

interface LastSdkCall {
  apiKey: string | null;
  teamId: string | null;
}
const lastCall: LastSdkCall = { apiKey: null, teamId: null };

function resetSdkSpy() {
  lastCall.apiKey = null;
  lastCall.teamId = null;
}

// Hoisted mock — the @linear/sdk path is imported by scoped-routes.ts so this
// has to be wired before dynamic imports. Records whichever apiKey + teamId
// the handler passed in, and returns minimal objects that exercise the awaits
// in the handler body.
vi.mock('@linear/sdk', () => {
  class LinearClient {
    constructor(opts: { apiKey: string }) {
      lastCall.apiKey = opts.apiKey;
    }
    issues() {
      return Promise.resolve({ nodes: [] });
    }
    team(teamId: string) {
      lastCall.teamId = teamId;
      return Promise.resolve({
        cycles: () => Promise.resolve({ nodes: [] }),
        members: () => Promise.resolve({ nodes: [] }),
      });
    }
  }
  return { LinearClient };
});

// wiki-rag must be stubbed — the handler spawns generateWiki as a detached
// promise, and letting the real pipeline run would clone a repo.
vi.mock('./wiki-rag', () => ({
  generateWiki: vi.fn(async () => undefined),
}));

// Dynamic imports so the mocks above are live when the module graph resolves.
type ScopedRoutes = typeof import('./scoped-routes');
let scoped: ScopedRoutes;

type JsonRes = { status: number; body: unknown };

interface CtxInit {
  params?: Record<string, string>;
  cookie?: string;
}
function makeCtx(init: CtxInit = {}): Context {
  const params = init.params ?? {};
  const cookie = init.cookie ?? 'better-auth.session_token=valid-token.sig';
  return {
    req: {
      param: (name: string) => params[name],
      header: (name: string) => (name === 'cookie' ? cookie : undefined),
      json: async () => ({}),
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
  // Columns mirror the runtime shape closely enough for the handlers.
  // `linear_team_id` is the legacy plaintext column the env-fallback path
  // still reads from. `linear_token` is intentionally left null — the new
  // code must not read it even when a row exists.
  await client.execute(`CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    repo_url TEXT,
    repo_default_branch TEXT,
    linear_token TEXT,
    linear_team_id TEXT,
    wiki_status TEXT,
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
  await client.execute(`CREATE TABLE wiki_documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  await client.execute(`CREATE TABLE wiki_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL
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
  // proj-owned: legacy `linear_team_id` present so env-fallback has something
  // to resolve; `linear_token` deliberately NULL to prove the flip doesn't
  // read the plaintext column anymore.
  await client.execute({
    sql: `INSERT INTO projects
            (id, user_id, name, repo_url, repo_default_branch, linear_token, linear_team_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    args: ['proj-owned', 'user-owner', 'mine', 'https://github.com/x/y', 'main', 'team-legacy', now, now],
  });
  await client.execute({
    sql: `INSERT INTO projects
            (id, user_id, name, repo_url, repo_default_branch, linear_token, linear_team_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    args: ['proj-foreign', 'user-other', 'not-mine', 'https://github.com/z/w', 'main', 'team-legacy', now, now],
  });
  return client;
}

describe('scoped-routes', () => {
  let originalMasterKey: string | undefined;
  let originalLinearKey: string | undefined;
  let client: Client;

  beforeEach(async () => {
    originalMasterKey = process.env.APP_MASTER_KEY;
    originalLinearKey = process.env.LINEAR_API_KEY;
    process.env.APP_MASTER_KEY = randomBytes(32).toString('base64');
    delete process.env.LINEAR_API_KEY;

    client = await seedDb();

    // Wire all four modules to the same in-memory client.
    const keys = await import('./integration-keys');
    const auth = await import('./auth-helpers');
    scoped = await import('./scoped-routes');
    keys.__setClientForTests(client);
    keys.__clearCacheForTests();
    auth.__setClientForTests(client);
    scoped.__setClientForTests(client);

    const tenantKeys = await import('./tenant-keys');
    tenantKeys.__clearLogCacheForTests();

    resetSdkSpy();
  });

  afterEach(async () => {
    const keys = await import('./integration-keys');
    const auth = await import('./auth-helpers');
    keys.__setClientForTests(null);
    keys.__clearCacheForTests();
    auth.__setClientForTests(null);
    scoped.__setClientForTests(null);

    vi.restoreAllMocks();

    if (originalMasterKey === undefined) delete process.env.APP_MASTER_KEY;
    else process.env.APP_MASTER_KEY = originalMasterKey;
    if (originalLinearKey === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = originalLinearKey;
  });

  // Helper: seed an encrypted tenant row via setIntegrationKey so the row's
  // ciphertext matches what getIntegrationKey expects.
  async function seedTenantLinear(
    projectId: string,
    apiKey: string,
    meta: Record<string, string>,
  ) {
    const { setIntegrationKey } = await import('./integration-keys');
    const res = await setIntegrationKey(projectId, 'linear', apiKey, meta);
    if (!res.ok) throw new Error('test setup failed: ' + res.reason);
  }

  describe('ownership gate', () => {
    it('returns 401 when no session cookie is present', async () => {
      const res = (await scoped.listProjectIssuesRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' }, cookie: '' }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(401);
    });

    it("returns 404 when caller doesn't own the target project", async () => {
      const res = (await scoped.listProjectIssuesRoute.handler(
        makeCtx({ params: { projectId: 'proj-foreign' } }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(404);
    });

    it('returns 404 for non-existent project (no existence leak)', async () => {
      const res = (await scoped.listProjectIssuesRoute.handler(
        makeCtx({ params: { projectId: 'ghost' } }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(404);
    });

    it('applies to the cycle handler', async () => {
      const res = (await scoped.getProjectCycleRoute.handler(
        makeCtx({ params: { projectId: 'proj-foreign' } }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(404);
    });

    it('applies to the members handler', async () => {
      const res = (await scoped.listProjectMembersRoute.handler(
        makeCtx({ params: { projectId: 'proj-foreign' }, cookie: '' }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(401);
    });

    it('applies to wiki-generate (mutation)', async () => {
      const res = (await scoped.generateProjectWikiRoute.handler(
        makeCtx({ params: { projectId: 'proj-foreign' } }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(404);
    });

    it('applies to wiki-status', async () => {
      const res = (await scoped.getProjectWikiStatusRoute.handler(
        makeCtx({ params: { projectId: 'proj-foreign' } }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(404);
    });
  });

  describe('linear credential resolution', () => {
    it('uses tenant row over env when both exist', async () => {
      process.env.LINEAR_API_KEY = 'env-should-not-win';
      await seedTenantLinear('proj-owned', 'tenant-pat', {
        teamId: 'team-tenant',
        teamName: 'Tenant',
        teamKey: 'TEN',
      });

      const res = (await scoped.listProjectIssuesRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(200);
      expect(lastCall.apiKey).toBe('tenant-pat');
      expect(lastCall.teamId).toBeNull(); // issues handler doesn't call team()
    });

    it('passes tenant teamId to team() in the cycle handler', async () => {
      await seedTenantLinear('proj-owned', 'tenant-pat', {
        teamId: 'team-tenant',
        teamName: 'Tenant',
        teamKey: 'TEN',
      });
      const res = (await scoped.getProjectCycleRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(200);
      expect(lastCall.apiKey).toBe('tenant-pat');
      expect(lastCall.teamId).toBe('team-tenant');
    });

    it('falls back to env + legacy projects.linear_team_id when no tenant row', async () => {
      process.env.LINEAR_API_KEY = 'env-fallback-key';
      const res = (await scoped.getProjectCycleRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(200);
      expect(lastCall.apiKey).toBe('env-fallback-key');
      expect(lastCall.teamId).toBe('team-legacy');
    });

    it('returns 400 NO_LINEAR_CONFIG when tenant missing teamId', async () => {
      await seedTenantLinear('proj-owned', 'tenant-pat', {
        /* meta without teamId */
        scratch: 'whatever',
      });
      const res = (await scoped.listProjectIssuesRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe('NO_LINEAR_CONFIG');
    });

    it('returns 400 NO_LINEAR_CONFIG when neither tenant nor env have a key', async () => {
      const res = (await scoped.listProjectIssuesRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      )) as unknown as JsonRes;
      expect(res.status).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe('NO_LINEAR_CONFIG');
    });

    it('never reads projects.linear_token plaintext (regression guard)', async () => {
      // Set a nonsense plaintext token on the project row directly — if the
      // flip left any read path for it, the SDK spy would capture it.
      await client.execute({
        sql: 'UPDATE projects SET linear_token = ? WHERE id = ?',
        args: ['plaintext-MUST-NOT-LEAK', 'proj-owned'],
      });
      process.env.LINEAR_API_KEY = 'env-ok';

      await scoped.listProjectIssuesRoute.handler(
        makeCtx({ params: { projectId: 'proj-owned' } }),
      );
      expect(lastCall.apiKey).not.toBe('plaintext-MUST-NOT-LEAK');
      expect(lastCall.apiKey).toBe('env-ok');
    });
  });
});
