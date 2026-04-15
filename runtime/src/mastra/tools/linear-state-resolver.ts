/**
 * Helper to resolve Linear state/label names to UUIDs at runtime.
 *
 * Consults Linear's API dynamically for the currently-configured LINEAR_TEAM_ID.
 * No hardcoded fallbacks — if a state/label doesn't exist in the team, returns
 * empty string and lets the caller skip that field. This prevents the
 * "LabelIds for incorrect team" error when the hardcoded IDs belong to a
 * different team than LINEAR_TEAM_ID.
 *
 * Results are cached per team in-memory for the lifetime of the process.
 */

import { LinearClient } from '@linear/sdk';
import { LINEAR_CONSTANTS } from '../../lib/config';

interface LabelMap {
  severity: Record<string, string>;
  category: Record<string, string>;
  all: Record<string, string>;
}

// Cache keyed by teamId so workspace switches don't return stale data.
const stateCache = new Map<string, Record<string, string>>();
const labelCache = new Map<string, LabelMap>();

async function loadStates(teamId: string, apiKey: string): Promise<Record<string, string>> {
  const cached = stateCache.get(teamId);
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
    stateCache.set(teamId, states);
    return states;
  } catch (error) {
    console.warn(`[linear-resolver] states fetch failed: ${error instanceof Error ? error.message : error}`);
    return {};
  }
}

async function loadLabels(teamId: string, apiKey: string): Promise<LabelMap> {
  const cached = labelCache.get(teamId);
  if (cached) return cached;

  try {
    const client = new LinearClient({ apiKey });
    const team = await client.team(teamId);
    const labelsConnection = await team.labels();
    const severity: Record<string, string> = {};
    const category: Record<string, string> = {};
    const all: Record<string, string> = {};
    for (const label of labelsConnection.nodes) {
      const name = label.name?.toUpperCase() ?? '';
      if (!name) continue;
      all[name] = label.id;
      if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'P0', 'P1', 'P2', 'P3', 'P4'].includes(name)) {
        severity[name] = label.id;
      }
      if (['BUG', 'FEATURE', 'IMPROVEMENT', 'ENHANCEMENT'].includes(name)) {
        category[name] = label.id;
      }
    }
    const result = { severity, category, all };
    labelCache.set(teamId, result);
    return result;
  } catch (error) {
    console.warn(`[linear-resolver] labels fetch failed: ${error instanceof Error ? error.message : error}`);
    return { severity: {}, category: {}, all: {} };
  }
}

/**
 * Resolve a state name (e.g., "TRIAGE", "DONE") to its UUID in the current team.
 * Returns empty string if not found — caller should handle that.
 */
export async function resolveStateId(stateName: string, apiKey?: string, teamId?: string): Promise<string> {
  const upperName = stateName.toUpperCase();
  const effectiveTeamId = teamId || LINEAR_CONSTANTS.TEAM_ID;
  if (!apiKey || !effectiveTeamId) return '';

  const states = await loadStates(effectiveTeamId, apiKey);
  const id = states[upperName];
  if (!id) {
    console.warn(`[linear-resolver] State "${stateName}" not found in team ${effectiveTeamId}`);
  }
  return id ?? '';
}

/**
 * Resolve a label name (e.g., "CRITICAL", "BUG") to its UUID in the current team.
 * Returns empty string if not found — caller should filter these out.
 */
export async function resolveLabelId(labelName: string, apiKey?: string, teamId?: string): Promise<string> {
  const upperName = labelName.toUpperCase();
  const effectiveTeamId = teamId || LINEAR_CONSTANTS.TEAM_ID;
  if (!apiKey || !effectiveTeamId) return '';

  const labels = await loadLabels(effectiveTeamId, apiKey);
  const id = labels.all[upperName];
  if (!id) {
    console.warn(`[linear-resolver] Label "${labelName}" not found in team ${effectiveTeamId} — skipping`);
  }
  return id ?? '';
}

/**
 * Clear cached states/labels (useful for testing or manual refresh).
 */
export function clearStateCache(): void {
  stateCache.clear();
  labelCache.clear();
}
