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
import { getUserIdFromRequest } from './auth-helpers';
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

let cachedClient: Client | null = null;
function getDb(): Client {
  if (cachedClient) return cachedClient;
  cachedClient = createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
  return cachedClient;
}

export function __setClientForTests(client: Client | null): void {
  cachedClient = client;
}

async function assertProjectOwnership(
  c: Context,
  projectId: string,
): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 404 }> {
  const userId = await getUserIdFromRequest(c);
  if (!userId) return { ok: false, status: 401 };
  const r = await getDb().execute({
    sql: 'SELECT 1 FROM projects WHERE id = ? AND user_id = ? LIMIT 1',
    args: [projectId, userId],
  });
  if (r.rows.length === 0) return { ok: false, status: 404 };
  return { ok: true, userId };
}

function authErrorResponse(c: Context, status: 401 | 404) {
  return c.json(
    {
      success: false,
      error: {
        code: status === 401 ? 'UNAUTHORIZED' : 'NOT_FOUND',
        message: status === 401 ? 'No valid session' : 'Project not found',
      },
    },
    status,
  );
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
type TestResult =
  | { valid: true }
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

async function runProviderTest(provider: IntegrationProvider, apiKey: string): Promise<TestResult> {
  switch (provider) {
    case 'openrouter':
      return testOpenRouterKey(apiKey);
    default:
      return { valid: false, reason: 'not_implemented' };
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
