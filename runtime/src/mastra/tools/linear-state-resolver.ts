/**
 * Helper to resolve Linear state/label names to UUIDs at runtime.
 *
 * This allows workflows to use state/label names instead of hardcoded UUIDs,
 * making them work with any Linear workspace configuration.
 */

import { LinearClient } from '@linear/sdk';
import { LINEAR_CONSTANTS } from '../../lib/config';

// In-memory cache for the current session
let stateCache: Record<string, string> | null = null;
let labelCache: { severity: Record<string, string>; category: Record<string, string> } | null = null;

/**
 * Resolve a state name (e.g., "TRIAGE", "DONE") to its UUID.
 *
 * Falls back to hardcoded values if:
 * - API call fails
 * - State not found in API
 * - No LINEAR_API_KEY configured
 */
export async function resolveStateId(stateName: string, apiKey?: string): Promise<string> {
  const upperName = stateName.toUpperCase();

  // Try cache first
  if (stateCache?.[upperName]) {
    return stateCache[upperName];
  }

  // Try API if key available
  if (apiKey) {
    try {
      const client = new LinearClient({ apiKey });
      const team = await client.team(LINEAR_CONSTANTS.TEAM_ID);
      const statesConnection = await team.states();
      const states: Record<string, string> = {};

      for (const state of statesConnection.nodes) {
        const name = state.name?.toUpperCase() ?? '';
        if (name) states[name] = state.id;
      }

      stateCache = states;

      if (states[upperName]) {
        return states[upperName];
      }
    } catch (error) {
      console.warn(`[resolveStateId] Failed to fetch states from API: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Fall back to hardcoded constants
  const fallback = LINEAR_CONSTANTS.STATES[upperName as keyof typeof LINEAR_CONSTANTS.STATES];
  if (fallback) {
    return fallback;
  }

  console.error(`[resolveStateId] State not found: ${stateName}`);
  return ''; // Return empty string if not found
}

/**
 * Resolve a label name (e.g., "CRITICAL", "BUG") to its UUID.
 *
 * Falls back to hardcoded values if API fails or label not found.
 */
export async function resolveLabelId(labelName: string, apiKey?: string): Promise<string> {
  const upperName = labelName.toUpperCase();

  // Try cache first
  if (labelCache) {
    if (labelCache.severity[upperName]) return labelCache.severity[upperName];
    if (labelCache.category[upperName]) return labelCache.category[upperName];
  }

  // Try API if key available
  if (apiKey) {
    try {
      const client = new LinearClient({ apiKey });
      const team = await client.team(LINEAR_CONSTANTS.TEAM_ID);
      const labelsConnection = await team.labels();

      const severity: Record<string, string> = {};
      const category: Record<string, string> = {};

      for (const label of labelsConnection.nodes) {
        const name = label.name?.toUpperCase() ?? '';

        if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'P0', 'P1', 'P2', 'P3', 'P4'].includes(name)) {
          severity[name] = label.id;
        }

        if (['BUG', 'FEATURE', 'IMPROVEMENT', 'ENHANCEMENT'].includes(name)) {
          category[name] = label.id;
        }
      }

      labelCache = { severity, category };

      if (severity[upperName]) return severity[upperName];
      if (category[upperName]) return category[upperName];
    } catch (error) {
      console.warn(`[resolveLabelId] Failed to fetch labels from API: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Fall back to hardcoded constants
  if (upperName in LINEAR_CONSTANTS.SEVERITY_LABELS) {
    return LINEAR_CONSTANTS.SEVERITY_LABELS[upperName as keyof typeof LINEAR_CONSTANTS.SEVERITY_LABELS];
  }
  if (upperName in LINEAR_CONSTANTS.CATEGORY_LABELS) {
    return LINEAR_CONSTANTS.CATEGORY_LABELS[upperName as keyof typeof LINEAR_CONSTANTS.CATEGORY_LABELS];
  }

  console.error(`[resolveLabelId] Label not found: ${labelName}`);
  return '';
}

/**
 * Clear cached states/labels (useful for testing)
 */
export function clearStateCache(): void {
  stateCache = null;
  labelCache = null;
}
