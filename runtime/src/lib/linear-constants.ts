/**
 * Dynamic Linear configuration — loads states, labels, and team info from Linear API.
 *
 * This replaces hardcoded IDs with dynamic lookups, allowing the system to work
 * with any Linear workspace without code changes.
 *
 * Uses in-memory caching with TTL (1 hour) to avoid excessive API calls.
 */

import { LinearClient } from '@linear/sdk';

// In-memory cache with TTL
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

/**
 * Linear state mapping — map state names to UUIDs.
 * Expected states: TRIAGE, BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, DONE, DUPLICATE, CANCELED
 */
export async function getLinearStates(teamId: string, apiKey: string): Promise<Record<string, string>> {
  const cacheKey = `linear-states:${teamId}`;
  const cached = getCached<Record<string, string>>(cacheKey);
  if (cached) return cached;

  try {
    const client = new LinearClient({ apiKey });
    const team = await client.team(teamId);
    const statesConnection = await team.states();
    const states: Record<string, string> = {};

    for (const state of statesConnection.nodes) {
      const name = state.name?.toUpperCase() ?? '';
      if (name) states[name] = state.id;
    }

    setCached(cacheKey, states);
    return states;
  } catch (error) {
    console.error('[linear-constants] Failed to load states:', error instanceof Error ? error.message : error);
    // Return empty object on error — caller will handle fallback
    return {};
  }
}

/**
 * Linear label mapping — map label names to UUIDs.
 * Filters by groups: severity (CRITICAL, HIGH, MEDIUM, LOW) and category (BUG, FEATURE, IMPROVEMENT)
 */
export async function getLinearLabels(teamId: string, apiKey: string): Promise<{
  severity: Record<string, string>;
  category: Record<string, string>;
}> {
  const cacheKey = `linear-labels:${teamId}`;
  const cached = getCached<{ severity: Record<string, string>; category: Record<string, string> }>(cacheKey);
  if (cached) return cached;

  try {
    const client = new LinearClient({ apiKey });
    const team = await client.team(teamId);
    const labelsConnection = await team.labels();

    const severity: Record<string, string> = {};
    const category: Record<string, string> = {};

    for (const label of labelsConnection.nodes) {
      const name = label.name?.toUpperCase() ?? '';

      // Heuristic: severity labels often contain severity keywords or are in a "Severity" group
      if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'P0', 'P1', 'P2', 'P3', 'P4'].includes(name)) {
        severity[name] = label.id;
      }

      // Heuristic: category labels are BUG, FEATURE, IMPROVEMENT
      if (['BUG', 'FEATURE', 'IMPROVEMENT', 'ENHANCEMENT'].includes(name)) {
        category[name] = label.id;
      }
    }

    const result = { severity, category };
    setCached(cacheKey, result);
    return result;
  } catch (error) {
    console.error('[linear-constants] Failed to load labels:', error instanceof Error ? error.message : error);
    return { severity: {}, category: {} };
  }
}

/**
 * Get team members from Linear API
 */
export async function getLinearTeamMembers(
  teamId: string,
  apiKey: string
): Promise<Array<{ id: string; name: string; email: string }>> {
  const cacheKey = `linear-members:${teamId}`;
  const cached = getCached<Array<{ id: string; name: string; email: string }>>(cacheKey);
  if (cached) return cached;

  try {
    const client = new LinearClient({ apiKey });
    const team = await client.team(teamId);
    const members = await team.members();

    const result = members.nodes
      .filter((m: { guest: boolean; active: boolean }) => !m.guest && m.active)
      .map((m: { id: string; name: string; email: string }) => ({
        id: m.id,
        name: m.name,
        email: m.email,
      }));

    setCached(cacheKey, result);
    return result;
  } catch (error) {
    console.error('[linear-constants] Failed to load team members:', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Clear all caches (useful for testing or manual refresh)
 */
export function clearLinearCache(): void {
  cache.clear();
}
