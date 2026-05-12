/**
 * Integration endpoints — per-project BYO API keys, envelope-encrypted.
 *
 * All routes require a Better Auth session and an ownership check against
 * `projects.user_id`. Keys are persisted via `setIntegrationKey` which
 * writes to `project_integrations` with AES-256-GCM envelope encryption
 * (see crypto-envelope.ts).
 *
 * Routes:
 *   GET    /projects/:projectId/integrations
 *   PUT    /projects/:projectId/integrations/:provider
 *   DELETE /projects/:projectId/integrations/:provider
 *   POST   /projects/:projectId/integrations/:provider/test
 */
import { registerApiRoute } from '@mastra/core/server';
import { createClient, type Client } from '@libsql/client';
import type { Context } from 'hono';
import { z } from 'zod';
import { assertProjectOwnership, authErrorResponse } from './auth-helpers';
import {
  deleteIntegrationKey,
  getIntegrationKey,
  listIntegrations,
  markTested,
  setIntegrationKey,
  type IntegrationSummary,
} from './integration-keys';
import {
  integrationMetaSchema,
  integrationProviderSchema,
  type IntegrationMeta,
  type IntegrationProvider,
} from './schemas/integrations';
import { parseGithubRepoUrl } from './github-repo';
import { generateWiki } from './wiki-rag';

// Shared DB client for project lookups that need to happen alongside
// integration writes (e.g. PUT /github reads repo_url + status to decide
// whether to trigger a wiki retry). Ownership checks still live in
// auth-helpers with their own client; this one is only for the project row
// reads/updates that used to be implicit.
let cachedClient: Client | null = null;
function getDb(): Client {
  if (cachedClient) return cachedClient;
  cachedClient = createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
  return cachedClient;
}

export function __setClientForTests(client: Client | null): void {
  cachedClient = client;
}

// `c.req.param` returns `string | undefined` — but when the route path
// declares the param, Mastra/Hono will never dispatch without it. Extract
// once so callers can rely on `string`.
function requireParam(c: Context, name: string): string | null {
  const v = c.req.param(name);
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function serializeSummary(s: IntegrationSummary) {
  return {
    provider: s.provider,
    status: s.status,
    meta: s.meta,
    lastTestedAt: s.lastTestedAt ? s.lastTestedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

const putBodySchema = z.object({
  apiKey: z.string().min(1, 'apiKey is required'),
  meta: integrationMetaSchema.optional(),
});

// ---------- GET /projects/:projectId/integrations ----------
export const listIntegrationsRoute = registerApiRoute(
  '/projects/:projectId/integrations',
  {
    method: 'GET',
    handler: async (c: Context) => {
      const projectId = requireParam(c, 'projectId');
      if (!projectId) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
      }
      const auth = await assertProjectOwnership(c, projectId);
      if (!auth.ok) return authErrorResponse(c, auth.status);

      try {
        const rows = await listIntegrations(projectId);
        return c.json({ success: true, data: rows.map(serializeSummary) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ success: false, error: { code: 'LIST_ERROR', message } }, 500);
      }
    },
  },
);

// ---------- PUT /projects/:projectId/integrations/:provider ----------
export const putIntegrationRoute = registerApiRoute(
  '/projects/:projectId/integrations/:provider',
  {
    method: 'PUT',
    handler: async (c: Context) => {
      const projectId = requireParam(c, 'projectId');
      if (!projectId) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
      }
      const providerRes = integrationProviderSchema.safeParse(requireParam(c, 'provider'));
      if (!providerRes.success) {
        return c.json(
          { success: false, error: { code: 'INVALID_PROVIDER', message: 'Unknown provider' } },
          400,
        );
      }
      const provider = providerRes.data;

      const auth = await assertProjectOwnership(c, projectId);
      if (!auth.ok) return authErrorResponse(c, auth.status);

      let body: z.infer<typeof putBodySchema>;
      try {
        const parsed = putBodySchema.safeParse(await c.req.json());
        if (!parsed.success) {
          return c.json(
            {
              success: false,
              error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'invalid body' },
            },
            400,
          );
        }
        body = parsed.data;
      } catch {
        return c.json(
          { success: false, error: { code: 'VALIDATION', message: 'invalid JSON body' } },
          400,
        );
      }

      // GitHub PUT has a richer contract: validate that the PAT can actually
      // reach the project's repo, then write meta ourselves (the project's
      // repo_url is the source of truth; body.meta is ignored). On success,
      // if the project was stuck in needs_auth or error, flip it back to
      // pending and fire a wiki retry.
      if (provider === 'github') {
        return handleGithubPut(c, projectId, body.apiKey);
      }

      const setRes = await setIntegrationKey(projectId, provider, body.apiKey, body.meta ?? {});
      if (!setRes.ok) {
        return c.json(
          {
            success: false,
            error: { code: 'MASTER_KEY_MISSING', message: 'APP_MASTER_KEY not configured' },
          },
          500,
        );
      }

      const rows = await listIntegrations(projectId);
      const entry = rows.find((r) => r.provider === provider);
      return c.json({ success: true, data: entry ? serializeSummary(entry) : null });
    },
  },
);

async function handleGithubPut(c: Context, projectId: string, apiKey: string) {
  const projectRow = await getDb().execute({
    sql: 'SELECT repo_url, status, repo_default_branch FROM projects WHERE id = ?',
    args: [projectId],
  });
  const project = projectRow.rows[0];
  if (!project) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } },
      404,
    );
  }
  const repoUrl = typeof project.repo_url === 'string' ? project.repo_url : '';
  const parsed = parseGithubRepoUrl(repoUrl);
  if (!parsed) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PROJECT_REPO_NOT_GITHUB',
          message:
            "This project's repository is not on GitHub. A GitHub token isn't needed here.",
        },
      },
      400,
    );
  }

  // Probe the repo WITH the PAT. 200 confirms access; 401/403 means the token
  // is valid on GitHub but lacks scope / collaboration on this repo; 404
  // usually means the same (private repo the token can't see).
  let probeRes: Response;
  try {
    probeRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'triage',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      { success: false, error: { code: 'NETWORK', message } },
      500,
    );
  }
  if (probeRes.status === 401 || probeRes.status === 403) {
    return c.json(
      {
        success: false,
        error: {
          code: 'REPO_ACCESS_DENIED',
          message: `PAT lacks access to ${parsed.owner}/${parsed.repo}. Ensure the \`repo\` scope is granted.`,
        },
      },
      400,
    );
  }
  if (probeRes.status === 404) {
    return c.json(
      {
        success: false,
        error: {
          code: 'REPO_NOT_FOUND_WITH_TOKEN',
          message: `Repository ${parsed.owner}/${parsed.repo} isn't visible to this PAT.`,
        },
      },
      400,
    );
  }
  if (probeRes.status !== 200) {
    return c.json(
      {
        success: false,
        error: { code: 'NETWORK', message: `HTTP ${probeRes.status}` },
      },
      500,
    );
  }

  const meta: IntegrationMeta = {
    owner: parsed.owner,
    repo: parsed.repo,
    repoFullName: `${parsed.owner}/${parsed.repo}`,
  };
  const setRes = await setIntegrationKey(projectId, 'github', apiKey, meta);
  if (!setRes.ok) {
    return c.json(
      {
        success: false,
        error: { code: 'MASTER_KEY_MISSING', message: 'APP_MASTER_KEY not configured' },
      },
      500,
    );
  }
  await markTested(projectId, 'github', true);

  const currentStatus = typeof project.status === 'string' ? project.status : '';
  if (currentStatus === 'needs_auth' || currentStatus === 'error') {
    await getDb().execute({
      sql: `UPDATE projects SET status = 'pending', wiki_error = NULL, updated_at = ? WHERE id = ?`,
      args: [Date.now(), projectId],
    });
    const branch =
      typeof project.repo_default_branch === 'string' && project.repo_default_branch.length > 0
        ? project.repo_default_branch
        : 'main';
    generateWiki(projectId, repoUrl, branch).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[integrations/github] Background wiki retry failed for ${projectId}:`, message);
    });
  }

  const rows = await listIntegrations(projectId);
  const entry = rows.find((r) => r.provider === 'github');
  return c.json({ success: true, data: entry ? serializeSummary(entry) : null });
}

// ---------- DELETE /projects/:projectId/integrations/:provider ----------
export const deleteIntegrationRoute = registerApiRoute(
  '/projects/:projectId/integrations/:provider',
  {
    method: 'DELETE',
    handler: async (c: Context) => {
      const projectId = requireParam(c, 'projectId');
      if (!projectId) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
      }
      const providerRes = integrationProviderSchema.safeParse(requireParam(c, 'provider'));
      if (!providerRes.success) {
        return c.json(
          { success: false, error: { code: 'INVALID_PROVIDER', message: 'Unknown provider' } },
          400,
        );
      }

      const auth = await assertProjectOwnership(c, projectId);
      if (!auth.ok) return authErrorResponse(c, auth.status);

      await deleteIntegrationKey(projectId, providerRes.data);
      return c.json({ success: true, data: { provider: providerRes.data, deleted: true } });
    },
  },
);

// ---------- Provider test dispatchers ----------
// `preview` carries non-secret selection options that the UI needs *before*
// the final save: Linear teams, Slack channels, GitHub repos. When present,
// the POST /test handler validates the key but does NOT persist — the client
// must follow up with PUT once the user has picked their meta. When absent
// (OpenRouter, Resend), the test endpoint persists on success as a shortcut.
type TestPreview = {
  teams?: Array<{ id: string; name: string; key: string }>;
  channels?: Array<{ id: string; name: string; isPrivate: boolean }>;
};

type TestResult =
  | { valid: true; preview?: TestPreview }
  | { valid: false; reason: 'invalid_key' | 'network' | 'not_implemented'; message?: string };

async function testOpenRouterKey(apiKey: string): Promise<TestResult> {
  // `/api/v1/auth/key` is the canonical validation endpoint — it 401s for
  // missing/invalid keys and 200s with key metadata for valid ones. The
  // `/v1/models` endpoint is public and returns 200 even for bogus tokens,
  // so it can't tell us whether the key is actually good.
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 200) return { valid: true };
    if (res.status === 401 || res.status === 403) return { valid: false, reason: 'invalid_key' };
    return { valid: false, reason: 'network', message: `HTTP ${res.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, reason: 'network', message };
  }
}

async function testLinearKey(apiKey: string): Promise<TestResult> {
  // Personal API Keys (what users paste in the UI) authenticate with the raw
  // token in the Authorization header — no "Bearer" prefix. OAuth access
  // tokens use Bearer, but those don't reach this endpoint.
  // https://linear.app/developers/graphql#personal-api-keys
  try {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: apiKey },
      body: JSON.stringify({
        query: `query { viewer { id name } teams(first: 100) { nodes { id name key } } }`,
      }),
    });
    if (res.status === 401 || res.status === 403) {
      return { valid: false, reason: 'invalid_key' };
    }
    if (res.status !== 200) {
      return { valid: false, reason: 'network', message: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      data?: {
        viewer?: { id?: string; name?: string };
        teams?: { nodes?: Array<{ id: string; name: string; key: string }> };
      };
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };
    // Linear returns 200 even for auth failures when the body is well-formed;
    // the GraphQL errors array carries the real status.
    if (json.errors && json.errors.length > 0) {
      const first = json.errors[0]!;
      const code = first.extensions?.code ?? '';
      if (code === 'AUTHENTICATION_ERROR' || /authentic/i.test(first.message)) {
        return { valid: false, reason: 'invalid_key' };
      }
      return { valid: false, reason: 'network', message: first.message };
    }
    if (!json.data?.viewer?.id) {
      return { valid: false, reason: 'invalid_key' };
    }
    const teams = (json.data.teams?.nodes ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      key: t.key,
    }));
    return { valid: true, preview: { teams } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, reason: 'network', message };
  }
}

async function testSlackKey(apiKey: string): Promise<TestResult> {
  // Slack Web API returns 200 with `{ok: false, error: '...'}` for auth
  // failures, not HTTP 401 — so the status check is secondary to the `ok`
  // flag. `auth.test` is the canonical bot-token validation endpoint.
  try {
    const authRes = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (authRes.status !== 200) {
      return { valid: false, reason: 'network', message: `HTTP ${authRes.status}` };
    }
    const authJson = (await authRes.json()) as {
      ok: boolean;
      error?: string;
      team?: string;
      user?: string;
    };
    if (!authJson.ok) {
      const reason = authJson.error === 'invalid_auth' || authJson.error === 'not_authed'
        ? 'invalid_key'
        : 'network';
      return { valid: false, reason, message: authJson.error };
    }
    // Fetch both public and private channels the bot is a member of. Slack
    // caps `limit` at 1000; for our UX 200 is plenty — users pick from the
    // top of the list, deep scans belong behind a search box.
    const listRes = await fetch(
      'https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200',
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    const listJson = (await listRes.json()) as {
      ok: boolean;
      error?: string;
      channels?: Array<{ id: string; name: string; is_private?: boolean }>;
    };
    // `conversations.list` needs `channels:read` + `groups:read`. A token with
    // only `chat:write` (common for minimal bots) lands here with missing_scope
    // even though it can still post messages. Treat this as "token valid, just
    // can't enumerate" — the UI falls back to a manual channelId input.
    if (!listJson.ok) {
      return { valid: true, preview: { channels: [] } };
    }
    const channels = (listJson.channels ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      isPrivate: Boolean(c.is_private),
    }));
    return { valid: true, preview: { channels } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, reason: 'network', message };
  }
}

async function testResendKey(apiKey: string): Promise<TestResult> {
  // `GET /domains` is the cheapest authenticated Resend endpoint — it 401s
  // for bad keys and 200s with the tenant's verified domains for good ones.
  // We don't surface domains as a picker (users paste a specific fromEmail)
  // but the 200/401 distinction is enough to validate the key.
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 200) return { valid: true };
    if (res.status === 401 || res.status === 403) return { valid: false, reason: 'invalid_key' };
    return { valid: false, reason: 'network', message: `HTTP ${res.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, reason: 'network', message };
  }
}

async function testGithubKey(apiKey: string): Promise<TestResult> {
  // Since #5d the picker is gone — PUT /integrations/github owns the
  // repo-access validation step. This endpoint only answers "is this PAT
  // real?" by hitting GET /user, which 401s on bad tokens.
  try {
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (userRes.status === 401 || userRes.status === 403) {
      return { valid: false, reason: 'invalid_key' };
    }
    if (userRes.status !== 200) {
      return { valid: false, reason: 'network', message: `HTTP ${userRes.status}` };
    }
    return { valid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, reason: 'network', message };
  }
}

async function runProviderTest(provider: IntegrationProvider, apiKey: string): Promise<TestResult> {
  switch (provider) {
    case 'openrouter':
      return testOpenRouterKey(apiKey);
    case 'linear':
      return testLinearKey(apiKey);
    case 'slack':
      return testSlackKey(apiKey);
    case 'resend':
      return testResendKey(apiKey);
    case 'github':
      return testGithubKey(apiKey);
  }
}

// ---------- POST /projects/:projectId/integrations/:provider/test ----------
export const testIntegrationRoute = registerApiRoute(
  '/projects/:projectId/integrations/:provider/test',
  {
    method: 'POST',
    handler: async (c: Context) => {
      const projectId = requireParam(c, 'projectId');
      if (!projectId) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
      }
      const providerRes = integrationProviderSchema.safeParse(requireParam(c, 'provider'));
      if (!providerRes.success) {
        return c.json(
          { success: false, error: { code: 'INVALID_PROVIDER', message: 'Unknown provider' } },
          400,
        );
      }
      const provider = providerRes.data;

      const auth = await assertProjectOwnership(c, projectId);
      if (!auth.ok) return authErrorResponse(c, auth.status);

      const parsed = putBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        // Test endpoint can also fall back to the stored key — useful for
        // "re-verify without re-entering the key".
        const stored = await getIntegrationKey(projectId, provider);
        if (!stored.ok) {
          return c.json(
            {
              success: false,
              error: { code: 'VALIDATION', message: 'apiKey is required (no stored key for this provider)' },
            },
            400,
          );
        }
        const result = await runProviderTest(provider, stored.plaintext);
        if (result.valid) {
          await markTested(projectId, provider, true);
        } else if (result.reason === 'invalid_key') {
          await markTested(projectId, provider, false);
        }
        return c.json({ success: true, data: result });
      }

      const body = parsed.data;
      const result = await runProviderTest(provider, body.apiKey);
      if (!result.valid) {
        // Do NOT persist on failure.
        return c.json({ success: true, data: result });
      }

      // Preview means the provider needs user input before persisting
      // (e.g. Linear team pick). Return the options; the client calls PUT
      // once the user has chosen. Test endpoint stays read-only in this case.
      if (result.preview) {
        return c.json({ success: true, data: { valid: true, preview: result.preview } });
      }

      const meta: IntegrationMeta = body.meta ?? {};
      const setRes = await setIntegrationKey(projectId, provider, body.apiKey, meta);
      if (!setRes.ok) {
        return c.json(
          {
            success: false,
            error: { code: 'MASTER_KEY_MISSING', message: 'APP_MASTER_KEY not configured' },
          },
          500,
        );
      }
      await markTested(projectId, provider, true);

      const rows = await listIntegrations(projectId);
      const entry = rows.find((r) => r.provider === provider);
      return c.json({
        success: true,
        data: { valid: true, integration: entry ? serializeSummary(entry) : null },
      });
    },
  },
);

export const integrationRoutes = [
  listIntegrationsRoute,
  putIntegrationRoute,
  deleteIntegrationRoute,
  testIntegrationRoute,
];
