/**
 * Integration tests for the multi-project triage API routes.
 *
 * Covers three route sets:
 *   - project-routes.ts   (CRUD on /projects)
 *   - integration-routes.ts (per-project /settings/*)
 *   - scoped-routes.ts    (per-project /linear/*, /wiki/*)
 *
 * Approach:
 *   - Mock @libsql/client so getDb() returns an in-memory fake with Map-backed
 *     `projects`, `wiki_documents`, and `wiki_chunks` stores.
 *   - Mock @linear/sdk so token validation, webhook creation, issue/team/cycle
 *     lookups and member listing are deterministic.
 *   - Mock globalThis.fetch for GitHub + Slack external calls.
 *   - Mock ./wiki-rag so generateWiki() is a no-op and does not spawn workers.
 *
 * Each route handler is invoked directly by calling `route.handler(mockCtx)`,
 * where mockCtx is a minimal Hono-like Context stub (just enough for req.param,
 * req.json and c.json).
 *
 * Data isolation tests create two distinct projects and assert that writes to
 * project A never leak into project B's state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory fake DB — shared by all mocked createClient() calls
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

const store = {
  projects: new Map<string, Row>(),
  wiki_documents: new Map<string, Row>(),
  wiki_chunks: new Map<string, Row>(),
  auth_session: new Map<string, Row>([
    ['test-session-token', { token: 'test-session-token', user_id: 'test-user-id' }],
  ]),
};

function resetStore() {
  store.projects.clear();
  store.wiki_documents.clear();
  store.wiki_chunks.clear();
  // Keep auth_session for tests
  if (!store.auth_session.has('test-session-token')) {
    store.auth_session.set('test-session-token', { token: 'test-session-token', user_id: 'test-user-id' });
  }
}

/**
 * Extremely small SQL interpreter: just enough to make project-routes,
 * integration-routes and scoped-routes work against our fake store.
 *
 * Supported patterns (matched by substring/prefix):
 *   - SELECT ... FROM projects ORDER BY created_at DESC       (list)
 *   - SELECT * FROM projects WHERE id = ?                     (single)
 *   - SELECT ... projects ... WHERE id = ?                    (single, subset cols)
 *   - INSERT INTO projects (...) VALUES (...)                 (create)
 *   - UPDATE projects SET <clause> WHERE id = ?               (update/integration)
 *   - DELETE FROM projects WHERE id = ?                       (delete)
 *   - SELECT COUNT(*) ... FROM wiki_documents WHERE project_id = ?
 *   - SELECT COUNT(*) ... FROM wiki_chunks WHERE document_id IN (SELECT id FROM wiki_documents WHERE project_id = ?)
 */
function fakeExecute(input: unknown, maybeArgs?: unknown[]): { rows: Row[]; rowsAffected: number } {
  let sql: string;
  let args: unknown[] = [];
  if (typeof input === 'string') {
    sql = input;
    args = (maybeArgs as unknown[]) ?? [];
  } else {
    const obj = input as { sql: string; args?: unknown[] };
    sql = obj.sql;
    args = obj.args ?? [];
  }
  const s = sql.trim();

  // ---------- projects: list ----------
  if (/^SELECT.*FROM projects\s+WHERE user_id\s*=\s*\?.*ORDER BY/i.test(s)) {
    const userId = args[0] as string;
    const rows = Array.from(store.projects.values())
      .filter((p) => p.user_id === userId)
      .sort((a, b) => Number(b.created_at) - Number(a.created_at));
    return { rows, rowsAffected: 0 };
  }

  // ---------- projects: list (fallback, no user filter) ----------
  if (/^SELECT.*FROM projects\s+ORDER BY/i.test(s)) {
    const rows = Array.from(store.projects.values()).sort(
      (a, b) => Number(b.created_at) - Number(a.created_at),
    );
    return { rows, rowsAffected: 0 };
  }

  // ---------- projects: single by id and user_id ----------
  if (/^SELECT.*FROM projects\s+WHERE id\s*=\s*\? AND user_id\s*=\s*\?/i.test(s)) {
    const id = args[0] as string;
    const userId = args[1] as string;
    const row = store.projects.get(id);
    return { rows: row && row.user_id === userId ? [row] : [], rowsAffected: 0 };
  }

  // ---------- projects: single by id (fallback, no user filter) ----------
  if (/^SELECT.*FROM projects\s+WHERE id\s*=\s*\?/i.test(s)) {
    const id = args[0] as string;
    const row = store.projects.get(id);
    return { rows: row ? [row] : [], rowsAffected: 0 };
  }

  // ---------- projects: insert ----------
  if (/^INSERT INTO projects/i.test(s)) {
    // Handle both: INSERT INTO projects (..., user_id, ...) and without user_id
    // For simplicity, assume: id, name, repo_url, repo_default_branch, created_at, updated_at, [user_id]
    let id: string, name: string, repo_url: string, repo_default_branch: string, created_at: number, updated_at: number;
    let user_id: string = 'test-user-id';

    if (args.length === 7) {
      [id, name, repo_url, repo_default_branch, created_at, updated_at, user_id] = args as [string, string, string, string, number, number, string];
    } else {
      [id, name, repo_url, repo_default_branch, created_at, updated_at] = args as [string, string, string, string, number, number];
    }

    store.projects.set(id, {
      id,
      user_id,
      name,
      repo_url,
      repo_default_branch,
      status: 'pending',
      wiki_status: null,
      wiki_error: null,
      documents_count: 0,
      chunks_count: 0,
      linear_token: null,
      linear_team_id: null,
      linear_webhook_id: null,
      linear_webhook_url: null,
      github_token: null,
      github_repo_owner: null,
      github_repo_name: null,
      slack_enabled: 0,
      slack_channel_id: null,
      slack_webhook_url: null,
      created_at,
      updated_at,
    });
    return { rows: [], rowsAffected: 1 };
  }

  // ---------- projects: update (PATCH /projects/:id) ----------
  const fullUpdate = /^UPDATE projects SET name = \?, repo_url = \?, repo_default_branch = \?, updated_at = \? WHERE id = \?/i;
  if (fullUpdate.test(s)) {
    const [name, repo_url, branch, updated_at, id] = args as [string, string, string, number, string];
    const row = store.projects.get(id);
    if (!row) return { rows: [], rowsAffected: 0 };
    row.name = name;
    row.repo_url = repo_url;
    row.repo_default_branch = branch;
    row.updated_at = updated_at;
    return { rows: [], rowsAffected: 1 };
  }

  // ---------- projects: partial integration update ----------
  // UPDATE projects SET <col> = ?, <col> = ?, updated_at = ? WHERE id = ?
  const partialUpdate = /^UPDATE projects SET\s+(.+?)\s+WHERE id\s*=\s*\?/i;
  if (partialUpdate.test(s) && /UPDATE projects SET/i.test(s)) {
    const match = s.match(partialUpdate);
    if (match) {
      const setClause = match[1];
      const cols = setClause.split(',').map((c) => c.trim().split('=')[0].trim());
      const id = args[args.length - 1] as string;
      const row = store.projects.get(id);
      if (!row) return { rows: [], rowsAffected: 0 };
      for (let i = 0; i < cols.length; i++) {
        row[cols[i]] = args[i];
      }
      return { rows: [], rowsAffected: 1 };
    }
  }

  // ---------- projects: delete ----------
  if (/^DELETE FROM projects WHERE/i.test(s) && s.includes('id')) {
    // Supports: DELETE FROM projects WHERE id = ? [AND user_id = ?]
    const id = args[0] as string;
    const userId = args.length > 1 ? (args[1] as string) : null;

    // Check user_id match if provided
    if (userId) {
      const project = store.projects.get(id);
      if (!project || project.user_id !== userId) {
        return { rows: [], rowsAffected: 0 };
      }
    }

    // Cascade: drop wiki_documents and their chunks for this project
    const docIds: string[] = [];
    for (const [docId, doc] of store.wiki_documents.entries()) {
      if (doc.project_id === id) {
        docIds.push(docId);
        store.wiki_documents.delete(docId);
      }
    }
    for (const [chunkId, chunk] of store.wiki_chunks.entries()) {
      if (docIds.includes(chunk.document_id as string)) {
        store.wiki_chunks.delete(chunkId);
      }
    }
    const existed = store.projects.delete(id);
    return { rows: [], rowsAffected: existed ? 1 : 0 };
  }

  // ---------- wiki_documents COUNT ----------
  if (/^SELECT COUNT\(\*\) as count FROM wiki_documents WHERE project_id/i.test(s)) {
    const pid = args[0] as string;
    const count = Array.from(store.wiki_documents.values()).filter((d) => d.project_id === pid).length;
    return { rows: [{ count }], rowsAffected: 0 };
  }

  // ---------- wiki_chunks COUNT (via subquery) ----------
  if (/^SELECT COUNT\(\*\) as count FROM wiki_chunks/i.test(s)) {
    const pid = args[0] as string;
    const docIds = new Set(
      Array.from(store.wiki_documents.values())
        .filter((d) => d.project_id === pid)
        .map((d) => d.id as string),
    );
    const count = Array.from(store.wiki_chunks.values()).filter((ch) =>
      docIds.has(ch.document_id as string),
    ).length;
    return { rows: [{ count }], rowsAffected: 0 };
  }

  // ---------- auth_session lookup ----------
  if (/^SELECT.*FROM auth_session WHERE token/i.test(s)) {
    const token = args[0] as string;
    const row = store.auth_session.get(token);
    return { rows: row ? [row] : [], rowsAffected: 0 };
  }

  // Fallthrough: return empty — helps debugging unexpected SQL
  return { rows: [], rowsAffected: 0 };
}

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => ({
    execute: (input: unknown, args?: unknown[]) => Promise.resolve(fakeExecute(input, args)),
  })),
}));

// Wiki-rag stub — prevents any real repo clone / embedding.
vi.mock('./wiki-rag', () => ({
  generateWiki: vi.fn(async () => undefined),
}));

// Linear SDK mock: variable behavior driven by `linearMockState`.
type LinearMockState = {
  viewerValue: unknown | null;
  viewerThrows: boolean;
  createWebhookResult: unknown;
  createWebhookThrows: boolean;
  teamMembers: Array<{ id: string; name: string; email: string; displayName: string; guest: boolean; active: boolean }>;
  activeCycle: Record<string, unknown> | null;
  issues: Array<Record<string, unknown>>;
  lastApiKey: string | null;
};

const linearMockState: LinearMockState = {
  viewerValue: { id: 'u1', name: 'Test User', email: 'u@test.io' },
  viewerThrows: false,
  createWebhookResult: {
    webhook: Promise.resolve({ id: 'wh-1', url: 'https://example.com/wh', enabled: true }),
  },
  createWebhookThrows: false,
  teamMembers: [
    { id: 'm1', name: 'Alice', email: 'a@t.io', displayName: 'alice', guest: false, active: true },
    { id: 'm2', name: 'Bob (guest)', email: 'b@t.io', displayName: 'bob', guest: true, active: true },
    { id: 'm3', name: 'Carol', email: 'c@t.io', displayName: 'carol', guest: false, active: false },
  ],
  activeCycle: {
    id: 'c-1',
    name: 'Cycle One',
    number: 1,
    startsAt: new Date('2026-04-01T00:00:00Z'),
    endsAt: new Date('2026-04-15T00:00:00Z'),
    progress: 0.5,
    scopeCount: 10,
    completedScopeCount: 5,
    startedScopeCount: 7,
  },
  issues: [],
  lastApiKey: null,
};

function resetLinearMock() {
  linearMockState.viewerValue = { id: 'u1', name: 'Test User', email: 'u@test.io' };
  linearMockState.viewerThrows = false;
  linearMockState.createWebhookThrows = false;
  linearMockState.createWebhookResult = {
    webhook: Promise.resolve({ id: 'wh-1', url: 'https://example.com/wh', enabled: true }),
  };
  linearMockState.issues = [];
  linearMockState.lastApiKey = null;
}

vi.mock('@linear/sdk', () => {
  class LinearClient {
    constructor(opts: { apiKey: string }) {
      linearMockState.lastApiKey = opts.apiKey;
    }
    get viewer() {
      if (linearMockState.viewerThrows) return Promise.reject(new Error('bad token'));
      return Promise.resolve(linearMockState.viewerValue);
    }
    createWebhook() {
      if (linearMockState.createWebhookThrows) return Promise.reject(new Error('webhook failed'));
      return Promise.resolve(linearMockState.createWebhookResult);
    }
    issues() {
      return Promise.resolve({ nodes: linearMockState.issues });
    }
    team() {
      return Promise.resolve({
        cycles: () =>
          Promise.resolve({
            nodes: linearMockState.activeCycle ? [linearMockState.activeCycle] : [],
          }),
        members: () => Promise.resolve({ nodes: linearMockState.teamMembers }),
      });
    }
  }
  return { LinearClient };
});

// ---------------------------------------------------------------------------
// Mock Hono Context factory
// ---------------------------------------------------------------------------
interface JsonResponse {
  status: number;
  body: unknown;
}

function makeCtx(opts: { params?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}) {
  const params = opts.params ?? {};
  const body = opts.body;
  // Default headers include a valid session cookie for auth
  const headers = {
    cookie: 'session=test-session-token',
    ...opts.headers,
  };
  return {
    req: {
      param: (key: string) => params[key],
      json: async () => body,
      header: (key: string) => headers[key],
    },
    json: (payload: unknown, status = 200): JsonResponse => ({ status, body: payload }),
  } as unknown as import('hono').Context & {
    __unused?: never;
  };
}

// ---------------------------------------------------------------------------
// Helper: seed a project row directly into the fake store (bypasses POST)
// ---------------------------------------------------------------------------
function seedProject(overrides: Partial<Row> = {}): Row {
  const id = (overrides.id as string) || `p-${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  const row: Row = {
    id,
    user_id: 'test-user-id', // Must match the user_id from test-session-token
    name: 'Seeded',
    repo_url: 'https://github.com/example/seed',
    repo_default_branch: 'main',
    status: 'pending',
    wiki_status: null,
    wiki_error: null,
    documents_count: 0,
    chunks_count: 0,
    linear_token: null,
    linear_team_id: null,
    linear_webhook_id: null,
    linear_webhook_url: null,
    github_token: null,
    github_repo_owner: null,
    github_repo_name: null,
    slack_enabled: 0,
    slack_channel_id: null,
    slack_webhook_url: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  store.projects.set(id, row);
  return row;
}

// ---------------------------------------------------------------------------
// Fetch mock (for GitHub + Slack)
// ---------------------------------------------------------------------------
const fetchMock = vi.fn();
beforeEach(() => {
  resetStore();
  resetLinearMock();
  fetchMock.mockReset();
  // Default fetch returns ok:true — tests override per case.
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ login: 'octocat', name: 'Octo Cat' }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

// ---------------------------------------------------------------------------
// Dynamic imports (after mocks wired)
// ---------------------------------------------------------------------------
async function loadProjectRoutes() {
  return await import('./project-routes');
}
async function loadScopedRoutes() {
  return await import('./scoped-routes');
}

// =============================================================================
// PROJECT CRUD ROUTES
// =============================================================================
describe('project-routes: CRUD', () => {
  describe('POST /projects', () => {
    it('creates a new project with 201 and returns serialized fields', async () => {
      const { createProjectRoute } = await loadProjectRoutes();
      const ctx = makeCtx({
        body: { name: 'P1', repositoryUrl: 'https://github.com/foo/bar', branch: 'dev' },
      });
      const res = (await createProjectRoute.handler(ctx)) as unknown as JsonResponse;
      expect(res.status).toBe(201);
      const body = res.body as { success: boolean; data: Row };
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('P1');
      expect(body.data.repositoryUrl).toBe('https://github.com/foo/bar');
      expect(body.data.branch).toBe('dev');
      expect(body.data.status).toBe('pending');
      expect(body.data.id).toBeDefined();
      // Persisted
      expect(store.projects.size).toBe(1);
    });

    it('defaults branch to "main" when not provided', async () => {
      const { createProjectRoute } = await loadProjectRoutes();
      const ctx = makeCtx({ body: { name: 'P2', repositoryUrl: 'https://g/h/r' } });
      const res = (await createProjectRoute.handler(ctx)) as unknown as JsonResponse;
      expect((res.body as { data: Row }).data.branch).toBe('main');
    });

    it('returns 400 when name is missing', async () => {
      const { createProjectRoute } = await loadProjectRoutes();
      const ctx = makeCtx({ body: { repositoryUrl: 'https://g/h/r' } });
      const res = (await createProjectRoute.handler(ctx)) as unknown as JsonResponse;
      expect(res.status).toBe(400);
      expect((res.body as { success: boolean }).success).toBe(false);
    });

    it('returns 400 when repositoryUrl is missing', async () => {
      const { createProjectRoute } = await loadProjectRoutes();
      const ctx = makeCtx({ body: { name: 'only name' } });
      const res = (await createProjectRoute.handler(ctx)) as unknown as JsonResponse;
      expect(res.status).toBe(400);
    });
  });

  describe('GET /projects', () => {
    it('lists all projects sorted by created_at DESC', async () => {
      seedProject({ id: 'a', name: 'A', created_at: 1000, updated_at: 1000 });
      seedProject({ id: 'b', name: 'B', created_at: 3000, updated_at: 3000 });
      seedProject({ id: 'c', name: 'C', created_at: 2000, updated_at: 2000 });
      const { listProjectsRoute } = await loadProjectRoutes();
      const res = (await listProjectsRoute.handler(makeCtx())) as unknown as JsonResponse;
      const body = res.body as { success: boolean; data: Row[] };
      expect(body.success).toBe(true);
      expect(body.data.map((p) => p.id)).toEqual(['b', 'c', 'a']);
    });

    it('returns empty array when no projects exist', async () => {
      const { listProjectsRoute } = await loadProjectRoutes();
      const res = (await listProjectsRoute.handler(makeCtx())) as unknown as JsonResponse;
      expect((res.body as { data: Row[] }).data).toEqual([]);
    });
  });

  describe('GET /projects/:id', () => {
    it('returns a project by id', async () => {
      seedProject({ id: 'p-one', name: 'OneName' });
      const { getProjectRoute } = await loadProjectRoutes();
      const res = (await getProjectRoute.handler(
        makeCtx({ params: { id: 'p-one' } }),
      )) as unknown as JsonResponse;
      expect(res.status).toBe(200);
      expect((res.body as { data: Row }).data.id).toBe('p-one');
      expect((res.body as { data: Row }).data.name).toBe('OneName');
    });

    it('returns 404 when project does not exist', async () => {
      const { getProjectRoute } = await loadProjectRoutes();
      const res = (await getProjectRoute.handler(
        makeCtx({ params: { id: 'nope' } }),
      )) as unknown as JsonResponse;
      expect(res.status).toBe(404);
      expect((res.body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /projects/:id', () => {
    it('updates name, repositoryUrl, branch', async () => {
      seedProject({ id: 'pu', name: 'Old', repo_url: 'old', repo_default_branch: 'main' });
      const { updateProjectRoute } = await loadProjectRoutes();
      const ctx = makeCtx({
        params: { id: 'pu' },
        body: { name: 'New', repositoryUrl: 'newurl', branch: 'dev' },
      });
      const res = (await updateProjectRoute.handler(ctx)) as unknown as JsonResponse;
      expect(res.status).toBe(200);
      const body = res.body as { data: Row };
      expect(body.data.name).toBe('New');
      expect(body.data.repositoryUrl).toBe('newurl');
      expect(body.data.branch).toBe('dev');
      // Persisted
      expect(store.projects.get('pu')!.name).toBe('New');
    });

    it('returns 404 on missing project', async () => {
      const { updateProjectRoute } = await loadProjectRoutes();
      const ctx = makeCtx({ params: { id: 'nope' }, body: { name: 'x' } });
      const res = (await updateProjectRoute.handler(ctx)) as unknown as JsonResponse;
      expect(res.status).toBe(404);
    });

    it('preserves fields when not supplied (partial update)', async () => {
      seedProject({ id: 'pp', name: 'Keep', repo_url: 'keep', repo_default_branch: 'main' });
      const { updateProjectRoute } = await loadProjectRoutes();
      const res = (await updateProjectRoute.handler(
        makeCtx({ params: { id: 'pp' }, body: { name: 'NewOnly' } }),
      )) as unknown as JsonResponse;
      const body = res.body as { data: Row };
      expect(body.data.name).toBe('NewOnly');
      expect(body.data.repositoryUrl).toBe('keep');
      expect(body.data.branch).toBe('main');
    });
  });

  describe('DELETE /projects/:id', () => {
    it('deletes an existing project and returns success', async () => {
      seedProject({ id: 'del' });
      const { deleteProjectRoute } = await loadProjectRoutes();
      const res = (await deleteProjectRoute.handler(
        makeCtx({ params: { id: 'del' } }),
      )) as unknown as JsonResponse;
      expect(res.status).toBe(200);
      expect((res.body as { success: boolean }).success).toBe(true);
      expect(store.projects.has('del')).toBe(false);
    });

    it('returns 404 when project does not exist', async () => {
      const { deleteProjectRoute } = await loadProjectRoutes();
      const res = (await deleteProjectRoute.handler(
        makeCtx({ params: { id: 'nope' } }),
      )) as unknown as JsonResponse;
      expect(res.status).toBe(404);
    });

    it('cascade deletes wiki_documents and wiki_chunks for the project', async () => {
      seedProject({ id: 'pc' });
      store.wiki_documents.set('d1', { id: 'd1', project_id: 'pc' });
      store.wiki_chunks.set('ch1', { id: 'ch1', document_id: 'd1' });
      const { deleteProjectRoute } = await loadProjectRoutes();
      await deleteProjectRoute.handler(makeCtx({ params: { id: 'pc' } }));
      expect(store.wiki_documents.has('d1')).toBe(false);
      expect(store.wiki_chunks.has('ch1')).toBe(false);
    });
  });
});

// =============================================================================
// DATA ISOLATION: two projects never see each other
// =============================================================================
describe('data isolation between projects', () => {
  it('deleting project A leaves project B untouched', async () => {
    seedProject({ id: 'A' });
    seedProject({ id: 'B' });
    const { deleteProjectRoute, getProjectRoute } = await loadProjectRoutes();
    await deleteProjectRoute.handler(makeCtx({ params: { id: 'A' } }));
    const res = (await getProjectRoute.handler(
      makeCtx({ params: { id: 'B' } }),
    )) as unknown as JsonResponse;
    expect(res.status).toBe(200);
  });

  it('wiki cascade on delete of A does not affect B', async () => {
    seedProject({ id: 'A' });
    seedProject({ id: 'B' });
    store.wiki_documents.set('dA', { id: 'dA', project_id: 'A' });
    store.wiki_documents.set('dB', { id: 'dB', project_id: 'B' });
    store.wiki_chunks.set('cA', { id: 'cA', document_id: 'dA' });
    store.wiki_chunks.set('cB', { id: 'cB', document_id: 'dB' });
    const { deleteProjectRoute } = await loadProjectRoutes();
    await deleteProjectRoute.handler(makeCtx({ params: { id: 'A' } }));
    expect(store.wiki_documents.has('dB')).toBe(true);
    expect(store.wiki_chunks.has('cB')).toBe(true);
  });

  // Scoped-routes coverage (ownership gate + tenant-key resolution) moved to
  // scoped-routes.test.ts with :memory: libsql + proper session cookies.
});

// Placeholder kept so the file numbering below doesn't shift for readers.
describe.skip('scoped-routes (moved to scoped-routes.test.ts)', () => {
  describe('GET /projects/:projectId/linear/issues', () => {
    it('404 when project not found', async () => {
      const { listProjectIssuesRoute } = await loadScopedRoutes();
      const res = (await listProjectIssuesRoute.handler(
        makeCtx({ params: { projectId: 'ghost' } }),
      )) as unknown as JsonResponse;
      expect(res.status).toBe(404);
    });

    it('400 when Linear integration is not configured', async () => {
      seedProject({ id: 'p1', linear_token: null });
      const { listProjectIssuesRoute } = await loadScopedRoutes();
      const res = (await listProjectIssuesRoute.handler(
        makeCtx({ params: { projectId: 'p1' } }),
      )) as unknown as JsonResponse;
      expect(res.status).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe('NO_LINEAR_CONFIG');
    });

    it('returns an object keyed by state name when issues are present', async () => {
      seedProject({ id: 'p1', linear_token: 't', linear_team_id: 'tm' });
      linearMockState.issues = [
        {
          id: 'i1',
          identifier: 'ABC-1',
          title: 'First',
          priority: 2,
          estimate: null,
          url: 'https://linear/i1',
          createdAt: new Date('2026-04-01'),
          updatedAt: new Date('2026-04-02'),
          state: Promise.resolve({ name: 'Todo' }),
          assignee: Promise.resolve(null),
          labels: () => Promise.resolve({ nodes: [] }),
          project: Promise.resolve(null),
        },
      ];
      const { listProjectIssuesRoute } = await loadScopedRoutes();
      const res = (await listProjectIssuesRoute.handler(
        makeCtx({ params: { projectId: 'p1' } }),
      )) as unknown as JsonResponse;
      expect(res.status).toBe(200);
      const body = res.body as { data: Record<string, Array<Row>> };
      expect(body.data.Todo).toBeDefined();
      expect(body.data.Todo[0].identifier).toBe('ABC-1');
    });
  });

  describe('GET /projects/:projectId/linear/cycle', () => {
    it('returns the active cycle when present', async () => {
      seedProject({ id: 'p1', linear_token: 't', linear_team_id: 'tm' });
      const { getProjectCycleRoute } = await loadScopedRoutes();
      const res = (await getProjectCycleRoute.handler(
        makeCtx({ params: { projectId: 'p1' } }),
      )) as unknown as JsonResponse;
      expect(res.status).toBe(200);
      const body = res.body as { data: { id: string; name: string } | null };
      expect(body.data?.id).toBe('c-1');
      expect(body.data?.name).toBe('Cycle One');
    });

    it('returns null when no active cycle', async () => {
      seedProject({ id: 'p1', linear_token: 't', linear_team_id: 'tm' });
      linearMockState.activeCycle = null;
      const { getProjectCycleRoute } = await loadScopedRoutes();
      const res = (await getProjectCycleRoute.handler(
        makeCtx({ params: { projectId: 'p1' } }),
      )) as unknown as JsonResponse;
      expect((res.body as { data: unknown }).data).toBeNull();
    });

    it('400 without linear token', async () => {
      seedProject({ id: 'p1' });
      const { getProjectCycleRoute } = await loadScopedRoutes();
      const res = (await getProjectCycleRoute.handler(
        makeCtx({ params: { projectId: 'p1' } }),
      )) as unknown as JsonResponse;
      expect(res.status).toBe(400);
    });
  });

  describe('GET /projects/:projectId/linear/members', () => {
    it('filters out guest and inactive members', async () => {
      seedProject({ id: 'p1', linear_token: 't', linear_team_id: 'tm' });
      const { listProjectMembersRoute } = await loadScopedRoutes();
      const res = (await listProjectMembersRoute.handler(
        makeCtx({ params: { projectId: 'p1' } }),
      )) as unknown as JsonResponse;
      const body = res.body as { data: { members: Array<{ id: string }> } };
      expect(body.data.members.map((m) => m.id)).toEqual(['m1']);
    });

    it('404 when project missing', async () => {
      const { listProjectMembersRoute } = await loadScopedRoutes();
      const res = (await listProjectMembersRoute.handler(
        makeCtx({ params: { projectId: 'ghost' } }),
      )) as unknown as JsonResponse;
      expect(res.status).toBe(404);
    });
  });

  describe('POST /projects/:projectId/wiki/generate', () => {
    it('marks project as processing and returns processing status', async () => {
      seedProject({ id: 'p1', repo_url: 'https://g/h/r', repo_default_branch: 'main' });
      const { generateProjectWikiRoute } = await loadScopedRoutes();
      const res = (await generateProjectWikiRoute.handler(
        makeCtx({ params: { projectId: 'p1' } }),
      )) as unknown as JsonResponse;
      expect(res.status).toBe(200);
      const body = res.body as { data: { status: string; projectId: string } };
      expect(body.data.status).toBe('processing');
      expect(body.data.projectId).toBe('p1');
      expect(store.projects.get('p1')!.wiki_status).toBe('processing');
    });

    it('404 when project missing', async () => {
      const { generateProjectWikiRoute } = await loadScopedRoutes();
      const res = (await generateProjectWikiRoute.handler(
        makeCtx({ params: { projectId: 'ghost' } }),
      )) as unknown as JsonResponse;
      expect(res.status).toBe(404);
    });
  });

  describe('GET /projects/:projectId/wiki/status', () => {
    it('reports counts for a project with no wiki data', async () => {
      seedProject({ id: 'p1' });
      const { getProjectWikiStatusRoute } = await loadScopedRoutes();
      const res = (await getProjectWikiStatusRoute.handler(
        makeCtx({ params: { projectId: 'p1' } }),
      )) as unknown as JsonResponse;
      const body = res.body as {
        data: { documents: number; chunks: number; done: boolean };
      };
      expect(body.data.documents).toBe(0);
      expect(body.data.chunks).toBe(0);
      expect(body.data.done).toBe(false);
    });

    it('marks done when wiki_status is ready', async () => {
      seedProject({ id: 'p1', wiki_status: 'ready' });
      const { getProjectWikiStatusRoute } = await loadScopedRoutes();
      const res = (await getProjectWikiStatusRoute.handler(
        makeCtx({ params: { projectId: 'p1' } }),
      )) as unknown as JsonResponse;
      expect((res.body as { data: { done: boolean } }).data.done).toBe(true);
    });
  });
});
