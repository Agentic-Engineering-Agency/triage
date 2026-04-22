import { getIntegrationKey } from './integration-keys';
import {
  integrationProviderSchema,
  type IntegrationMeta,
  type IntegrationProvider,
} from './schemas/integrations';

/**
 * Resolve an API key for a given provider + project, with automatic fallback
 * to `process.env`. Bridges the gap between the legacy env-based config and
 * the per-tenant `project_integrations` table while the UI (#5) is still WIP.
 *
 * Contract:
 *   - `projectId` present AND tenant row exists → returns the decrypted key.
 *   - `projectId` missing, tenant not_found, master key missing, or any other
 *     recoverable miss → falls back to `process.env.<VAR>` (when envFallback
 *     is enabled, which it is by default).
 *   - Nothing anywhere → `{ key: null, source: 'none' }`.
 *
 * Callers should treat `source` as informational only — the key is what
 * matters for behaviour. Source is logged once per (projectId, provider)
 * when it changes so we can see in logs which projects moved off env.
 */

export const PROVIDER_ENV_VARS: Readonly<Record<IntegrationProvider, string>> =
  Object.freeze({
    linear: 'LINEAR_API_KEY',
    resend: 'RESEND_API_KEY',
    slack: 'SLACK_BOT_TOKEN',
    github: 'GITHUB_TOKEN',
    openrouter: 'OPENROUTER_API_KEY',
  });

export type KeySource = 'tenant' | 'env' | 'none';

export interface ResolveKeyResult {
  key: string | null;
  /**
   * Non-secret per-provider metadata from the tenant row (e.g. Linear teamId,
   * Slack channelId, Resend fromEmail). Empty object when the key resolved
   * via env fallback or not at all — callers should layer their own env-level
   * defaults on top.
   */
  meta: IntegrationMeta;
  source: KeySource;
}

export interface ResolveKeyOptions {
  /** Default: true. Set to false to require a tenant key (strict mode). */
  envFallback?: boolean;
}

const lastLoggedSource = new Map<string, KeySource>();

function logSourceOnce(
  projectId: string | null | undefined,
  provider: IntegrationProvider,
  source: KeySource,
): void {
  const scope = projectId ?? '<no-project>';
  const cacheKey = `${scope}:${provider}`;
  const prev = lastLoggedSource.get(cacheKey);
  if (prev === source) return;
  lastLoggedSource.set(cacheKey, source);
  console.log(
    `[tenant-keys] project=${scope} provider=${provider} source=${source}`,
  );
}

export function __clearLogCacheForTests(): void {
  lastLoggedSource.clear();
}

export async function resolveKey(
  provider: IntegrationProvider,
  projectId?: string | null,
  opts: ResolveKeyOptions = {},
): Promise<ResolveKeyResult> {
  const parsedProvider = integrationProviderSchema.parse(provider);
  const envFallback = opts.envFallback ?? true;

  if (projectId) {
    const res = await getIntegrationKey(projectId, parsedProvider);
    if (res.ok) {
      logSourceOnce(projectId, parsedProvider, 'tenant');
      return { key: res.plaintext, meta: res.meta, source: 'tenant' };
    }
    // `decrypt_failed` is a real failure (tampered row, wrong master key for
    // this ciphertext) — do NOT silently fall back, surface it as 'none' so
    // the caller's error path runs instead of quietly using an env key for a
    // project that explicitly has a configured (but broken) integration.
    if (res.reason === 'decrypt_failed') {
      logSourceOnce(projectId, parsedProvider, 'none');
      return { key: null, meta: {}, source: 'none' };
    }
    // not_found | master_key_missing → try env fallback.
  }

  if (envFallback) {
    const envVar = PROVIDER_ENV_VARS[parsedProvider];
    const envKey = process.env[envVar];
    if (envKey && envKey.length > 0) {
      logSourceOnce(projectId, parsedProvider, 'env');
      return { key: envKey, meta: {}, source: 'env' };
    }
  }

  logSourceOnce(projectId, parsedProvider, 'none');
  return { key: null, meta: {}, source: 'none' };
}
