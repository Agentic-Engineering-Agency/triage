/**
 * Memory context initialization for orchestrator agent.
 *
 * Provides minimal workspace context. All Linear IDs (states, labels, members)
 * are resolved dynamically via tools — the agent should use list-linear-issues,
 * get-team-members, and list-linear-cycles to query the current workspace
 * rather than relying on hardcoded IDs.
 */

import { LINEAR_CONSTANTS, LINEAR_BASE_URL } from './config';

export function serializeLinearContext(): string {
  return `## Linear Workspace Context

Team ID: ${LINEAR_CONSTANTS.TEAM_ID}
Base URL: ${LINEAR_BASE_URL}

### How to resolve IDs
- Team members: call get-team-members
- Existing issues: call list-linear-issues
- Cycles: call list-linear-cycles

All IDs are fetched live from the Linear API — never guess or hardcode them.`;
}

export function getMemoryInitializationContext(): string {
  return serializeLinearContext();
}
