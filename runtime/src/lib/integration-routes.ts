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

// `__setClientForTests` historically lived here so tests could wire a shared
// :memory: client across integration-routes + integration-keys + auth-helpers.
// Kept as a no-op passthrough now that ownership is in auth-helpers — the DB
// client for ownership lives there. Remove once test setup drops this call.
export function __setClientForTests(_client: unknown): void {
  /* no-op: ownership DB is now owned by auth-helpers */
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
// `preview` carries non-secret selection options that the UI needs *before*
// the final save: Linear teams, Slack channels, GitHub repos. When present,
// the POST /test handler validates the key but does NOT persist — the client
// must follow up with PUT once the user has picked their meta. When absent
// (OpenRouter), the test endpoint persists on success as a shortcut.
type TestPreview = {
  teams?: Array<{ id: string; name: string; key: string }>;
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

async function runProviderTest(provider: IntegrationProvider, apiKey: string): Promise<TestResult> {
  switch (provider) {
    case 'openrouter':
      return testOpenRouterKey(apiKey);
    case 'linear':
      return testLinearKey(apiKey);
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
