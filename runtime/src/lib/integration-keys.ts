import { createClient, type Client } from '@libsql/client';
import { decrypt, encrypt, loadMasterKey } from './crypto-envelope';
import {
  integrationMetaSchema,
  integrationProviderSchema,
  integrationStatusSchema,
  type IntegrationMeta,
  type IntegrationProvider,
  type IntegrationStatus,
} from './schemas/integrations';

/**
 * Per-tenant integration keys (BYO API keys) with envelope encryption.
 *
 * Secrets are encrypted at rest under APP_MASTER_KEY via crypto-envelope;
 * plaintext only lives in memory during a call or inside the short-lived
 * cache. Status and metadata are returned non-secret so callers can render
 * UI without decrypting.
 */

let cachedClient: Client | null = null;

function getClient(): Client {
  if (cachedClient) return cachedClient;
  const url = process.env.LIBSQL_URL || 'http://libsql:8080';
  cachedClient = createClient({ url });
  return cachedClient;
}

export function __setClientForTests(client: Client | null): void {
  cachedClient = client;
}

const CACHE_TTL_MS = 60_000;

type CacheEntry = {
  plaintext: string;
  meta: IntegrationMeta;
  status: IntegrationStatus;
  lastTestedAt: Date | null;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const cacheKey = (projectId: string, provider: IntegrationProvider): string =>
  `${projectId}:${provider}`;

export function __clearCacheForTests(): void {
  cache.clear();
}

export type SetIntegrationResult =
  | { ok: true }
  | { ok: false; reason: 'master_key_missing' };

export type GetIntegrationResult =
  | {
      ok: true;
      plaintext: string;
      meta: IntegrationMeta;
      status: IntegrationStatus;
      lastTestedAt: Date | null;
    }
  | { ok: false; reason: 'not_found' | 'decrypt_failed' | 'master_key_missing' };

export interface IntegrationSummary {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  meta: IntegrationMeta;
  lastTestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toBuffer(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (raw instanceof ArrayBuffer) return Buffer.from(new Uint8Array(raw));
  throw new Error('expected BLOB value, got ' + typeof raw);
}

function parseMeta(raw: unknown): IntegrationMeta {
  if (raw === null || raw === undefined) return {};
  const str = String(raw);
  if (str === '') return {};
  return integrationMetaSchema.parse(JSON.parse(str));
}

function toTimestamp(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  return new Date(Number(raw));
}

export async function setIntegrationKey(
  projectId: string,
  provider: IntegrationProvider,
  plaintext: string,
  meta: IntegrationMeta = {},
): Promise<SetIntegrationResult> {
  const keyRes = loadMasterKey();
  if (!keyRes.ok) return { ok: false, reason: 'master_key_missing' };

  const parsedProvider = integrationProviderSchema.parse(provider);
  const parsedMeta = integrationMetaSchema.parse(meta);
  const encrypted = encrypt(plaintext, keyRes.key);
  const now = Date.now();

  await getClient().execute({
    sql: `INSERT INTO project_integrations
            (project_id, provider, encrypted_key, meta, status, last_tested_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
          ON CONFLICT(project_id, provider) DO UPDATE SET
            encrypted_key = excluded.encrypted_key,
            meta = excluded.meta,
            status = excluded.status,
            last_tested_at = NULL,
            updated_at = excluded.updated_at`,
    args: [projectId, parsedProvider, encrypted, JSON.stringify(parsedMeta), 'active', now, now],
  });

  cache.delete(cacheKey(projectId, parsedProvider));
  return { ok: true };
}

export async function getIntegrationKey(
  projectId: string,
  provider: IntegrationProvider,
): Promise<GetIntegrationResult> {
  const ck = cacheKey(projectId, provider);
  const hit = cache.get(ck);
  if (hit && hit.expiresAt > Date.now()) {
    return {
      ok: true,
      plaintext: hit.plaintext,
      meta: hit.meta,
      status: hit.status,
      lastTestedAt: hit.lastTestedAt,
    };
  }

  const keyRes = loadMasterKey();
  if (!keyRes.ok) return { ok: false, reason: 'master_key_missing' };

  const r = await getClient().execute({
    sql: `SELECT encrypted_key, meta, status, last_tested_at
          FROM project_integrations WHERE project_id = ? AND provider = ? LIMIT 1`,
    args: [projectId, provider],
  });
  const row = r.rows[0];
  if (!row) return { ok: false, reason: 'not_found' };

  const dec = decrypt(toBuffer(row.encrypted_key), keyRes.key);
  if (!dec.ok) return { ok: false, reason: 'decrypt_failed' };

  const meta = parseMeta(row.meta);
  const status = integrationStatusSchema.parse(String(row.status));
  const lastTestedAt = toTimestamp(row.last_tested_at);

  cache.set(ck, {
    plaintext: dec.plaintext,
    meta,
    status,
    lastTestedAt,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return { ok: true, plaintext: dec.plaintext, meta, status, lastTestedAt };
}

export async function listIntegrations(projectId: string): Promise<IntegrationSummary[]> {
  const r = await getClient().execute({
    sql: `SELECT provider, meta, status, last_tested_at, created_at, updated_at
          FROM project_integrations WHERE project_id = ? ORDER BY provider`,
    args: [projectId],
  });
  return r.rows.map((row) => ({
    provider: integrationProviderSchema.parse(String(row.provider)),
    status: integrationStatusSchema.parse(String(row.status)),
    meta: parseMeta(row.meta),
    lastTestedAt: toTimestamp(row.last_tested_at),
    createdAt: new Date(Number(row.created_at)),
    updatedAt: new Date(Number(row.updated_at)),
  }));
}

export async function deleteIntegrationKey(
  projectId: string,
  provider: IntegrationProvider,
): Promise<void> {
  await getClient().execute({
    sql: `DELETE FROM project_integrations WHERE project_id = ? AND provider = ?`,
    args: [projectId, provider],
  });
  cache.delete(cacheKey(projectId, provider));
}

export async function markTested(
  projectId: string,
  provider: IntegrationProvider,
  success: boolean,
): Promise<void> {
  const now = Date.now();
  const newStatus: IntegrationStatus = success ? 'active' : 'invalid';
  await getClient().execute({
    sql: `UPDATE project_integrations
          SET status = ?, last_tested_at = ?, updated_at = ?
          WHERE project_id = ? AND provider = ?`,
    args: [newStatus, now, now, projectId, provider],
  });
  cache.delete(cacheKey(projectId, provider));
}
