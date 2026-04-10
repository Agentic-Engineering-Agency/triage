/**
 * Memory context initialization for orchestrator agent.
 *
 * Stores LINEAR_CONSTANTS and context hints in agent memory once per conversation.
 * This avoids repeating 2000+ tokens of static data in the system prompt on every request.
 *
 * Called at conversation start to populate memory with:
 * - Team members (with Linear IDs and Slack mentions)
 * - Label definitions (severity, category)
 * - Issue state IDs
 * - Linear base URL
 */

import { LINEAR_CONSTANTS, LINEAR_BASE_URL } from './config';

/**
 * Serialize LINEAR_CONSTANTS into a memory context hint.
 * Stored in memory as a single reusable context entry.
 */
export function serializeLinearContext(): string {
  const members = Object.values(LINEAR_CONSTANTS.MEMBERS)
    .map(m => `${m.name} (Linear: ${m.linearId}${m.slackId ? `, Slack: <@${m.slackId}>` : ''})`)
    .join('\n');

  return `## Linear Configuration Context (stored in memory)

Team ID: ${LINEAR_CONSTANTS.TEAM_ID}
Base URL: ${LINEAR_BASE_URL}

### Team Members
${members}

### Severity Labels
- Critical: ${LINEAR_CONSTANTS.SEVERITY_LABELS.CRITICAL}
- High: ${LINEAR_CONSTANTS.SEVERITY_LABELS.HIGH}
- Medium: ${LINEAR_CONSTANTS.SEVERITY_LABELS.MEDIUM}
- Low: ${LINEAR_CONSTANTS.SEVERITY_LABELS.LOW}

### Category Labels
- Bug: ${LINEAR_CONSTANTS.CATEGORY_LABELS.BUG}
- Feature: ${LINEAR_CONSTANTS.CATEGORY_LABELS.FEATURE}
- Improvement: ${LINEAR_CONSTANTS.CATEGORY_LABELS.IMPROVEMENT}

### Issue States
- Triage: ${LINEAR_CONSTANTS.STATES.TRIAGE}
- Backlog: ${LINEAR_CONSTANTS.STATES.BACKLOG}
- Todo: ${LINEAR_CONSTANTS.STATES.TODO}
- In Progress: ${LINEAR_CONSTANTS.STATES.IN_PROGRESS}
- In Review: ${LINEAR_CONSTANTS.STATES.IN_REVIEW}
- Done: ${LINEAR_CONSTANTS.STATES.DONE}

NOTE: These IDs are available in memory context. Tools have access to them directly via config.`;
}

/**
 * Initialize memory context for a new conversation.
 * Should be called once when a thread is created, before the first message.
 */
export function getMemoryInitializationContext(): string {
  return serializeLinearContext();
}
