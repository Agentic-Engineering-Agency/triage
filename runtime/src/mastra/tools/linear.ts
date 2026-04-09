import { createTool } from '@mastra/core/tools';
import { LinearClient } from '@linear/sdk';
import { z } from 'zod';
import { config, LINEAR_CONSTANTS } from '../../lib/config';

// ---------------------------------------------------------------------------
// Inline Zod schemas mirroring canonical definitions.
// Canonical location: @/lib/schemas/ticket.ts (ticketCreateSchema)
// Canonical location: @/lib/schemas/triage.ts  (severitySchema, prioritySchema)
// ---------------------------------------------------------------------------

const severityEnum = z.enum(['Critical', 'High', 'Medium', 'Low']);
const priorityEnum = z.enum(['P0', 'P1', 'P2', 'P3', 'P4']);

/** Fields required to create a Linear issue (mirrors ticketCreateSchema). */
const ticketCreateInputSchema = z.object({
  title: z.string().describe('Issue title'),
  description: z.string().describe('Markdown description of the issue'),
  severity: severityEnum.describe('Severity level'),
  priority: priorityEnum.describe('Priority level (P0–P4)'),
  teamKey: z.string().describe('Linear team key, e.g. "SRE"'),
  assigneeId: z.string().optional().describe('Linear user ID to assign'),
  labels: z.array(z.string()).optional().describe('Label names to apply'),
});

/** Fields returned after issue creation / retrieval (mirrors ticketResponseSchema). */
const ticketResponseSchema = z.object({
  id: z.string().describe('Linear issue UUID'),
  identifier: z.string().describe('Human-readable identifier, e.g. SRE-42'),
  title: z.string(),
  url: z.string().url().describe('Linear issue URL'),
  state: z.string().describe('Current workflow state name'),
  severity: severityEnum,
  priority: priorityEnum,
  assigneeId: z.string().nullable(),
  createdAt: z.string().describe('ISO 8601 timestamp'),
});

/** Extended response that includes the full description body. */
const ticketResponseWithDescriptionSchema = ticketResponseSchema.extend({
  description: z.string().nullable().describe('Markdown body of the issue'),
});

// ---------------------------------------------------------------------------
// Linear client singleton
// ---------------------------------------------------------------------------

const linearClient = config.LINEAR_API_KEY
  ? new LinearClient({ apiKey: config.LINEAR_API_KEY })
  : null;

// ---------------------------------------------------------------------------
// Priority mapping helpers
// ---------------------------------------------------------------------------

const PRIORITY_TO_NUMBER: Record<string, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

const NUMBER_TO_PRIORITY: Record<number, string> = {
  0: 'P0',
  1: 'P1',
  2: 'P2',
  3: 'P3',
  4: 'P4',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate error messages to 200 chars for PII-safe logging. */
function safeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
}

/** Map a severity string to its Linear label ID. */
function severityToLabelId(severity: string): string | undefined {
  const key = severity.toUpperCase() as keyof typeof LINEAR_CONSTANTS.SEVERITY_LABELS;
  return LINEAR_CONSTANTS.SEVERITY_LABELS[key];
}

/** Update field allowlist for updateLinearIssue. */
const UPDATE_ALLOWLIST = ['title', 'description', 'priority', 'assigneeId', 'stateId', 'labelIds'] as const;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const createLinearIssueTool = createTool({
  id: 'create-linear-issue',
  description: 'Create a new Linear issue for an SRE incident.',
  inputSchema: ticketCreateInputSchema,
  outputSchema: ticketResponseSchema,
  execute: async ({ context }) => {
    if (!linearClient) {
      console.warn('[Linear] No API key configured — skipping issue creation');
      return {
        id: 'skipped',
        identifier: 'NONE-0',
        title: context.title,
        url: 'https://linear.app',
        state: 'Triage',
        severity: context.severity,
        priority: context.priority,
        assigneeId: null,
        createdAt: new Date().toISOString(),
      };
    }

    try {
      // Build label IDs
      const labelIds: string[] = [];
      const sevLabelId = severityToLabelId(context.severity);
      if (sevLabelId) labelIds.push(sevLabelId);
      if (context.labels) {
        for (const label of context.labels) {
          const catKey = label.toUpperCase() as keyof typeof LINEAR_CONSTANTS.CATEGORY_LABELS;
          const catId = LINEAR_CONSTANTS.CATEGORY_LABELS[catKey];
          if (catId) labelIds.push(catId);
        }
      }

      const result = await linearClient.createIssue({
        teamId: LINEAR_CONSTANTS.TEAM_ID,
        title: context.title,
        description: context.description,
        priority: PRIORITY_TO_NUMBER[context.priority] ?? 3,
        assigneeId: context.assigneeId,
        stateId: LINEAR_CONSTANTS.STATES.TRIAGE,
        labelIds: labelIds.length > 0 ? labelIds : undefined,
      });

      const issue = await result.issue;
      if (!issue) throw new Error('Issue creation returned no issue');

      const state = await issue.state;

      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        state: state?.name ?? 'Unknown',
        severity: context.severity,
        priority: context.priority,
        assigneeId: issue.assigneeId ?? null,
        createdAt: issue.createdAt.toISOString(),
      };
    } catch (err) {
      console.error(`[Linear] createIssue failed: ${safeError(err)}`);
      throw err;
    }
  },
});

export const updateLinearIssueTool = createTool({
  id: 'update-linear-issue',
  description: 'Update an existing Linear issue.',
  inputSchema: z.object({
    issueId: z.string().describe('Linear issue UUID or identifier'),
    title: z.string().optional(),
    description: z.string().optional(),
    severity: severityEnum.optional(),
    priority: priorityEnum.optional(),
    assigneeId: z.string().optional(),
    labels: z.array(z.string()).optional(),
    stateId: z.string().optional().describe('Workflow state ID to transition to'),
  }),
  outputSchema: ticketResponseSchema,
  execute: async ({ context }) => {
    if (!linearClient) {
      console.warn('[Linear] No API key configured — skipping issue update');
      return {
        id: context.issueId,
        identifier: 'NONE-0',
        title: context.title ?? '',
        url: 'https://linear.app',
        state: 'Unknown',
        severity: context.severity ?? 'Medium',
        priority: context.priority ?? 'P3',
        assigneeId: null,
        createdAt: new Date().toISOString(),
      };
    }

    try {
      // Build the update payload using the allowlist
      const updatePayload: Record<string, unknown> = {};

      if (context.title !== undefined) updatePayload.title = context.title;
      if (context.description !== undefined) updatePayload.description = context.description;
      if (context.priority !== undefined) updatePayload.priority = PRIORITY_TO_NUMBER[context.priority] ?? 3;
      if (context.assigneeId !== undefined) updatePayload.assigneeId = context.assigneeId;
      if (context.stateId !== undefined) updatePayload.stateId = context.stateId;

      // Handle labels — merge severity label + category labels
      if (context.labels !== undefined || context.severity !== undefined) {
        const labelIds: string[] = [];
        if (context.severity) {
          const sevId = severityToLabelId(context.severity);
          if (sevId) labelIds.push(sevId);
        }
        if (context.labels) {
          for (const label of context.labels) {
            const catKey = label.toUpperCase() as keyof typeof LINEAR_CONSTANTS.CATEGORY_LABELS;
            const catId = LINEAR_CONSTANTS.CATEGORY_LABELS[catKey];
            if (catId) labelIds.push(catId);
          }
        }
        if (labelIds.length > 0) updatePayload.labelIds = labelIds;
      }

      // Filter to allowlist only
      const safePayload: Record<string, unknown> = {};
      for (const key of UPDATE_ALLOWLIST) {
        if (key in updatePayload) {
          safePayload[key] = updatePayload[key];
        }
      }

      await linearClient.updateIssue(context.issueId, safePayload);

      // Fetch updated issue
      const issue = await linearClient.issue(context.issueId);
      const state = await issue.state;
      const labels = await issue.labels();

      // Determine severity from labels
      const severityLabelNames = Object.keys(LINEAR_CONSTANTS.SEVERITY_LABELS);
      let foundSeverity: string = context.severity ?? 'Medium';
      for (const label of labels.nodes) {
        const upper = label.name.toUpperCase();
        if (severityLabelNames.includes(upper)) {
          foundSeverity = label.name.charAt(0).toUpperCase() + label.name.slice(1).toLowerCase();
          break;
        }
      }

      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        state: state?.name ?? 'Unknown',
        severity: foundSeverity as 'Critical' | 'High' | 'Medium' | 'Low',
        priority: (NUMBER_TO_PRIORITY[issue.priority] ?? 'P3') as 'P0' | 'P1' | 'P2' | 'P3' | 'P4',
        assigneeId: issue.assigneeId ?? null,
        createdAt: issue.createdAt.toISOString(),
      };
    } catch (err) {
      console.error(`[Linear] updateIssue failed: ${safeError(err)}`);
      throw err;
    }
  },
});

export const getLinearIssueTool = createTool({
  id: 'get-linear-issue',
  description: 'Get details of a Linear issue by ID or identifier.',
  inputSchema: z.object({
    issueId: z.string().describe('Linear issue UUID or human-readable identifier (e.g. SRE-42)'),
  }),
  outputSchema: ticketResponseWithDescriptionSchema,
  execute: async ({ context }) => {
    if (!linearClient) {
      console.warn('[Linear] No API key configured — skipping issue fetch');
      return {
        id: context.issueId,
        identifier: 'NONE-0',
        title: '',
        url: 'https://linear.app',
        state: 'Unknown',
        severity: 'Medium' as const,
        priority: 'P3' as const,
        assigneeId: null,
        createdAt: new Date().toISOString(),
        description: null,
      };
    }

    try {
      const issue = await linearClient.issue(context.issueId);

      // Resolve related entities
      const state = await issue.state;
      const assignee = await issue.assignee;
      const labels = await issue.labels();

      // Determine severity from labels
      const severityLabelNames = Object.keys(LINEAR_CONSTANTS.SEVERITY_LABELS);
      let foundSeverity: string = 'Medium';
      for (const label of labels.nodes) {
        const upper = label.name.toUpperCase();
        if (severityLabelNames.includes(upper)) {
          foundSeverity = label.name.charAt(0).toUpperCase() + label.name.slice(1).toLowerCase();
          break;
        }
      }

      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        state: state?.name ?? 'Unknown',
        severity: foundSeverity as 'Critical' | 'High' | 'Medium' | 'Low',
        priority: (NUMBER_TO_PRIORITY[issue.priority] ?? 'P3') as 'P0' | 'P1' | 'P2' | 'P3' | 'P4',
        assigneeId: assignee?.id ?? null,
        createdAt: issue.createdAt.toISOString(),
        description: issue.description ?? null,
      };
    } catch (err) {
      console.error(`[Linear] getIssue failed: ${safeError(err)}`);
      throw err;
    }
  },
});

export const listLinearIssuesTool = createTool({
  id: 'list-linear-issues',
  description: 'List Linear issues with optional filters.',
  inputSchema: z.object({
    teamKey: z.string().optional().describe('Filter by team key'),
    stateType: z.string().optional().describe('Filter by state type (e.g. "started", "completed")'),
    limit: z.number().int().min(1).max(100).optional().default(25).describe('Max results to return'),
  }),
  outputSchema: z.object({
    issues: z.array(ticketResponseSchema),
  }),
  execute: async ({ context }) => {
    if (!linearClient) {
      console.warn('[Linear] No API key configured — skipping issue list');
      return { issues: [] };
    }

    try {
      const limit = context.limit ?? 25;

      // Build filter object
      const filter: Record<string, unknown> = {};

      if (context.teamKey) {
        filter.team = { key: { eq: context.teamKey } };
      }

      if (context.stateType) {
        filter.state = { type: { eq: context.stateType } };
      }

      const result = await linearClient.issues({
        filter,
        first: limit,
        orderBy: LinearClient.name ? undefined : undefined, // use default ordering
      });

      const issues = await Promise.all(
        result.nodes.map(async (issue) => {
          const state = await issue.state;
          const labels = await issue.labels();

          // Determine severity from labels
          const severityLabelNames = Object.keys(LINEAR_CONSTANTS.SEVERITY_LABELS);
          let foundSeverity: string = 'Medium';
          for (const label of labels.nodes) {
            const upper = label.name.toUpperCase();
            if (severityLabelNames.includes(upper)) {
              foundSeverity = label.name.charAt(0).toUpperCase() + label.name.slice(1).toLowerCase();
              break;
            }
          }

          return {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            url: issue.url,
            state: state?.name ?? 'Unknown',
            severity: foundSeverity as 'Critical' | 'High' | 'Medium' | 'Low',
            priority: (NUMBER_TO_PRIORITY[issue.priority] ?? 'P3') as 'P0' | 'P1' | 'P2' | 'P3' | 'P4',
            assigneeId: issue.assigneeId ?? null,
            createdAt: issue.createdAt.toISOString(),
          };
        }),
      );

      return { issues };
    } catch (err) {
      console.error(`[Linear] listIssues failed: ${safeError(err)}`);
      throw err;
    }
  },
});

export const getTeamMembersTool = createTool({
  id: 'get-team-members',
  description: 'Get team members from Linear.',
  inputSchema: z.object({
    teamKey: z.string().optional().describe('Team key to scope members; omit for all org members'),
  }),
  outputSchema: z.object({
    members: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
      }),
    ),
  }),
  execute: async ({ context }) => {
    if (!linearClient) {
      console.warn('[Linear] No API key configured — skipping team members fetch');
      return { members: [] };
    }

    try {
      let users;

      if (context.teamKey) {
        // Fetch members scoped to a specific team
        const teams = await linearClient.teams({ filter: { key: { eq: context.teamKey } } });
        const team = teams.nodes[0];
        if (!team) {
          return { members: [] };
        }
        const membersConnection = await team.members();
        users = membersConnection.nodes;
      } else {
        // Fetch all org members
        const result = await linearClient.users();
        users = result.nodes;
      }

      // Filter out bots and Linear OAuth app accounts
      const BOT_EMAIL_PATTERNS = ['@linear.linear.app', '@oauthapp.linear.app'];
      const members = users
        .filter((user) => {
          if (!user.email) return false;
          if (user.active === false) return false;
          // Filter out bot emails
          for (const pattern of BOT_EMAIL_PATTERNS) {
            if (user.email.endsWith(pattern)) return false;
          }
          return true;
        })
        .map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email!,
        }));

      return { members };
    } catch (err) {
      console.error(`[Linear] getTeamMembers failed: ${safeError(err)}`);
      throw err;
    }
  },
});
