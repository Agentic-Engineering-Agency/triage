/**
 * Tests for the GitHub privacy probe in POST /projects.
 *
 * Doesn't extend the old project-routes.test.ts because that file uses a
 * hand-rolled SQL interpreter over Maps and is part of the 106-test failing
 * baseline. Same pattern as scoped-routes.test.ts: :memory: libsql wired via
 * __setClientForTests, fetch stubbed, generateWiki mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import type { Context } from 'hono';

const generateWikiMock = vi.fn(async () => ({
  projectId: '',
  documentsProcessed: 0,
  chunksCreated: 0,
  success: true,
}));

vi.mock('./wiki-rag', () => ({ generateWiki: generateWikiMock }));

type ProjectRoutes = typeof import('./project-routes');
let routes: ProjectRoutes;

type JsonRes = { status: number; body: unknown };

interface CtxInit {
  body?: unknown;
  cookie?: string;
}
function makeCtx(init: CtxInit = {}): Context {
  const cookie = init.cookie ?? 'better-auth.session_token=valid-token.sig';
  const body = init.body;
  return {
    req: {
      param: () => undefined,
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
    linear_token TEXT,
    linear_team_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  const now = Date.now();
  await client.execute({
    sql: 'INSERT INTO auth_session (id, user_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: ['s1', 'user-owner', 'valid-token', now + 1_000_000, now, now],
  });
  return client;
}

describe('POST /projects — GitHub privacy probe', () => {
  let client: Client;

  beforeEach(async () => {
    generateWikiMock.mockClear();
    client = await seedDb();
    routes = await import('./project-routes');
    routes.__setClientForTests(client);
  });

  afterEach(() => {
    routes.__setClientForTests(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('public repo: status stays pending + generateWiki fires', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 200, json: async () => ({}) })),
    );

    const res = (await routes.createProjectRoute.handler(
      makeCtx({
        body: {
          name: 'Public',
          repositoryUrl: 'https://github.com/vercel/next.js',
          branch: 'canary',
        },
      }),
    )) as unknown as JsonRes;

    expect(res.status).toBe(201);
    const body = res.body as { success: boolean; data: { id: string; status: string } };
    expect(body.data.status).toBe('pending');

    const row = (await client.execute('SELECT status, wiki_error FROM projects LIMIT 1'))
      .rows[0];
    expect(row.status).toBe('pending');
    expect(row.wiki_error).toBeNull();

    expect(generateWikiMock).toHaveBeenCalledTimes(1);
    expect(generateWikiMock).toHaveBeenCalledWith(
      body.data.id,
      'https://github.com/vercel/next.js',
      'canary',
    );
  });

  it('private/missing repo (404): status=needs_auth, wiki_error set, generateWiki NOT fired', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 404, json: async () => ({}) })),
    );

    const res = (await routes.createProjectRoute.handler(
      makeCtx({
        body: {
          name: 'Private',
          repositoryUrl: 'https://github.com/ghost/private',
        },
      }),
    )) as unknown as JsonRes;

    expect(res.status).toBe(201);
    const body = res.body as { data: { id: string; status: string; error: string | null } };
    expect(body.data.status).toBe('needs_auth');
    expect(body.data.error).toMatch(/Private repo|Connect GitHub/i);

    const row = (await client.execute('SELECT status, wiki_error FROM projects LIMIT 1'))
      .rows[0];
    expect(row.status).toBe('needs_auth');
    expect(String(row.wiki_error)).toMatch(/Connect GitHub/i);

    expect(generateWikiMock).not.toHaveBeenCalled();
  });

  it('timeout / network error: falls back to public path (status=pending, generateWiki fires)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('aborted');
      }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = (await routes.createProjectRoute.handler(
      makeCtx({
        body: {
          name: 'Flaky',
          repositoryUrl: 'https://github.com/owner/flaky',
        },
      }),
    )) as unknown as JsonRes;

    expect(res.status).toBe(201);
    const body = res.body as { data: { status: string } };
    expect(body.data.status).toBe('pending');

    const row = (await client.execute('SELECT status FROM projects LIMIT 1')).rows[0];
    expect(row.status).toBe('pending');

    expect(generateWikiMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('non-GitHub repo (gitlab): skips probe, proceeds as public', async () => {
    const fetchSpy = vi.fn(async () => ({ status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchSpy);

    const res = (await routes.createProjectRoute.handler(
      makeCtx({
        body: {
          name: 'GitLab',
          repositoryUrl: 'https://gitlab.com/owner/repo',
        },
      }),
    )) as unknown as JsonRes;

    expect(res.status).toBe(201);
    expect((res.body as { data: { status: string } }).data.status).toBe('pending');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(generateWikiMock).toHaveBeenCalledTimes(1);
  });
});
