/**
 * Linear issue sync — fetches all issues from Linear API (with relations resolved),
 * stores the full grouped response in a local cache table.
 *
 * This eliminates ~200 sequential API calls per board load (50 issues x 4 async
 * property resolutions) by caching the resolved data locally.
 */

import { LinearClient } from '@linear/sdk';
import { createClient } from '@libsql/client';
import { config, LINEAR_CONSTANTS } from './config';

// In-memory tracking of last sync time (also persisted in DB)
let lastSyncedAt: Date | null = null;
let syncInProgress = false;

const libsqlUrl = process.env.LIBSQL_URL || 'http://libsql:8080';

export function getLastSyncedAt(): Date | null {
  return lastSyncedAt;
}

export function isSyncInProgress(): boolean {
  return syncInProgress;
}

/**
 * Fetch all issues from Linear API with all relations resolved,
 * then store the full grouped result in the linear_sync_cache table.
 *
 * Returns the grouped issues data.
 */
export async function syncLinearIssues(): Promise<Record<string, Array<Record<string, unknown>>>> {
  if (!config.LINEAR_API_KEY) {
    throw new Error('LINEAR_API_KEY not configured');
  }

  if (syncInProgress) {
    console.log('[linear-sync] Sync already in progress, skipping');
    // Return current cached data if available
    const cached = await getCachedIssues();
    if (cached) return cached;
    throw new Error('Sync in progress and no cached data available');
  }

  syncInProgress = true;
  console.log('[linear-sync] Starting sync...');
  const startTime = Date.now();

  try {
    const linearClient = new LinearClient({ apiKey: config.LINEAR_API_KEY });

    const issues = await linearClient.issues({
      filter: { team: { id: { eq: LINEAR_CONSTANTS.TEAM_ID } } },
      first: 50,
    });

    const grouped: Record<string, Array<Record<string, unknown>>> = {};

    for (const issue of issues.nodes) {
      const state = await issue.state;
      const stateName = state?.name ?? 'Unknown';
      if (!grouped[stateName]) grouped[stateName] = [];

      const assigneeNode = await issue.assignee;
      const labelsConnection = await issue.labels();
      let projectName: string | null = null;
      try {
        const proj = await issue.project;
        if (proj) projectName = proj.name;
      } catch { /* project may not exist */ }

      grouped[stateName].push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        priority: issue.priority,
        estimate: issue.estimate ?? null,
        project: projectName,
        url: issue.url,
        createdAt: issue.createdAt?.toISOString?.() ?? String(issue.createdAt),
        updatedAt: issue.updatedAt?.toISOString?.() ?? String(issue.updatedAt),
        assignee: assigneeNode ? { id: assigneeNode.id, name: assigneeNode.name } : null,
        labels: labelsConnection.nodes.map((l: { id: string; name: string; color: string }) => ({
          id: l.id,
          name: l.name,
          color: l.color,
        })),
      });
    }

    // Persist to DB
    const db = createClient({ url: libsqlUrl });
    const now = Date.now();

    await db.execute({
      sql: `INSERT OR REPLACE INTO linear_sync_cache (id, team_id, data, synced_at)
            VALUES (?, ?, ?, ?)`,
      args: ['default', LINEAR_CONSTANTS.TEAM_ID, JSON.stringify(grouped), now],
    });

    lastSyncedAt = new Date(now);
    const elapsed = Date.now() - startTime;
    const totalIssues = Object.values(grouped).flat().length;
    console.log(`[linear-sync] Sync complete: ${totalIssues} issues in ${elapsed}ms`);

    return grouped;
  } finally {
    syncInProgress = false;
  }
}

/**
 * Read cached issues from the DB.
 * Returns null if no cache exists.
 */
export async function getCachedIssues(): Promise<Record<string, Array<Record<string, unknown>>> | null> {
  try {
    const db = createClient({ url: libsqlUrl });
    const result = await db.execute({
      sql: 'SELECT data, synced_at FROM linear_sync_cache WHERE id = ?',
      args: ['default'],
    });

    const row = result.rows[0];
    if (!row) return null;

    // Update in-memory lastSyncedAt from DB if not set
    if (!lastSyncedAt && row.synced_at) {
      lastSyncedAt = new Date(Number(row.synced_at));
    }

    return JSON.parse(row.data as string) as Record<string, Array<Record<string, unknown>>>;
  } catch (error) {
    console.error('[linear-sync] Failed to read cache:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Initialize sync on startup: load lastSyncedAt from DB, then trigger a background sync.
 */
export async function initLinearSync(): Promise<void> {
  try {
    // Load last sync time from DB
    const db = createClient({ url: libsqlUrl });
    const result = await db.execute({
      sql: 'SELECT synced_at FROM linear_sync_cache WHERE id = ?',
      args: ['default'],
    });

    const row = result.rows[0];
    if (row?.synced_at) {
      lastSyncedAt = new Date(Number(row.synced_at));
      console.log(`[linear-sync] Last synced at: ${lastSyncedAt.toISOString()}`);
    }

    // Trigger background sync if Linear is configured
    if (config.LINEAR_API_KEY) {
      console.log('[linear-sync] Triggering startup sync...');
      syncLinearIssues().catch((err) => {
        console.error('[linear-sync] Startup sync failed:', err instanceof Error ? err.message : err);
      });
    } else {
      console.log('[linear-sync] LINEAR_API_KEY not configured, skipping sync');
    }
  } catch (error) {
    console.error('[linear-sync] Init failed:', error instanceof Error ? error.message : error);
  }
}
