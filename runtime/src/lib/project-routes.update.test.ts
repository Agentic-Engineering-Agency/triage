/**
 * Tests for PATCH /projects/:id — specifically the side-effect that flips
 * an active GitHub integration to `status='invalid'` when `repo_url` changes.
 *
 * Same `:memory:` libsql pattern as project-routes.probe.test.ts and
 * scoped-routes.test.ts. Avoids the legacy Map-store interpreter that
 * powers project-routes.test.ts (part of the 106-test failing baseline).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import type { Context } from 'hono';

vi.mock('./wiki-rag', () => ({
  generateWiki: vi.fn(async () => undefined),
}));

type ProjectRoutes = typeof import('./project-routes');
let routes: ProjectRoutes;

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
    wiki_status TEXT,
    wiki_error TEXT,
    error TEXT,
    documents_count INTEGER DEFAULT 0,
    chunks_count INTEGER DEFAULT 0,
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
    sql: `INSERT INTO projects (id, user_id, name, repo_url, repo_default_branch, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: ['proj-1', 'user-owner', 'mine', 'https://github.com/old/repo', 'main', now, now],
  });
  return client;
}

async function seedGithubIntegration(
  client: Client,
  projectId: string,
  status: 'active' | 'invalid' | 'disabled' = 'active',
) {
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO project_integrations
            (project_id, provider, encrypted_key, meta, status, created_at, updated_at)
          VALUES (?, 'github', ?, ?, ?, ?, ?)`,
    args: [
      projectId,
      new Uint8Array([1, 2, 3]),
      JSON.stringify({ repoFullName: 'old/repo', owner: 'old', repo: 'repo' }),
      status,
      now,
      now,
    ],
  });
}

async function getGithubIntegrationStatus(
  client: Client,
  projectId: string,
): Promise<string | null> {
  const r = await client.execute({
    sql: 'SELECT status FROM project_integrations WHERE project_id = ? AND provider = ?',
    args: [projectId, 'github'],
  });
  return r.rows[0] ? String(r.rows[0].status) : null;
}

describe('PATCH /projects/:id — github integration invalidation on repo_url change', () => {
  let client: Client;

  beforeEach(async () => {
    client = await seedDb();
    routes = await import('./project-routes');
    routes.__setClientForTests(client);
  });

  afterEach(() => {
    routes.__setClientForTests(null);
    vi.restoreAllMocks();
  });

  it('flips active github integration to invalid when repo_url changes', async () => {
    await seedGithubIntegration(client, 'proj-1', 'active');

    const res = (await routes.updateProjectRoute.handler(
      makeCtx({
        params: { id: 'proj-1' },
        body: { repositoryUrl: 'https://github.com/new/repo' },
      }),
    )) as unknown as JsonRes;

    expect(res.status).toBe(200);
    expect(await getGithubIntegrationStatus(client, 'proj-1')).toBe('invalid');
  });

  it('leaves github integration untouched when repo_url stays the same', async () => {
    await seedGithubIntegration(client, 'proj-1', 'active');

    const res = (await routes.updateProjectRoute.handler(
      makeCtx({
        params: { id: 'proj-1' },
        body: { repositoryUrl: 'https://github.com/old/repo', name: 'renamed' },
      }),
    )) as unknown as JsonRes;

    expect(res.status).toBe(200);
    expect(await getGithubIntegrationStatus(client, 'proj-1')).toBe('active');
  });

  it('leaves github integration untouched when repositoryUrl is not in the PATCH body', async () => {
    await seedGithubIntegration(client, 'proj-1', 'active');

    const res = (await routes.updateProjectRoute.handler(
      makeCtx({
        params: { id: 'proj-1' },
        body: { name: 'just rename' },
      }),
    )) as unknown as JsonRes;

    expect(res.status).toBe(200);
    expect(await getGithubIntegrationStatus(client, 'proj-1')).toBe('active');
  });

  it('does not touch already-invalid github integration (no-op for non-active rows)', async () => {
    await seedGithubIntegration(client, 'proj-1', 'invalid');

    const res = (await routes.updateProjectRoute.handler(
      makeCtx({
        params: { id: 'proj-1' },
        body: { repositoryUrl: 'https://github.com/different/repo' },
      }),
    )) as unknown as JsonRes;

    expect(res.status).toBe(200);
    // Already 'invalid' — the UPDATE WHERE clause filters on status='active'
    // so this row's row count stays whatever it was. We only assert the
    // status remains a valid value, not the updated_at timestamp.
    expect(await getGithubIntegrationStatus(client, 'proj-1')).toBe('invalid');
  });

  it('succeeds (200) when project has no github integration to invalidate', async () => {
    // No integration seeded — PATCH still works, UPDATE on integrations is a no-op
    const res = (await routes.updateProjectRoute.handler(
      makeCtx({
        params: { id: 'proj-1' },
        body: { repositoryUrl: 'https://github.com/new/repo' },
      }),
    )) as unknown as JsonRes;

    expect(res.status).toBe(200);
    expect(await getGithubIntegrationStatus(client, 'proj-1')).toBeNull();
  });
});
