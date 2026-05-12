import { createTool } from '@mastra/core/tools';
import { LinearClient } from '@linear/sdk';
import { z } from 'zod';
import { LINEAR_CONSTANTS } from '../../lib/config';
import { resolveKey } from '../../lib/tenant-keys';
import {
  ticketCreateSchema,
  ticketUpdateSchema,
  issueSearchSchema,
  issueIdInputSchema,
  teamIdInputSchema,
} from '../../lib/schemas/ticket';

type ToolCtx = { requestContext?: { get: (key: string) => unknown } } | undefined;

// Resolve a per-tenant LinearClient. Reads projectId from the tool's
// requestContext (populated by the x-project-id middleware for agent calls,
// or by the synthetic runtimeContext in the workflow's callTool helper).
// Falls back to `process.env.LINEAR_API_KEY` when no tenant row exists,
// preserving the legacy single-tenant setup until every project has keys in
// `project_integrations`.
async function resolveLinearClient(
  toolCtx: ToolCtx,
): Promise<{ client: InstanceType<typeof LinearClient> | null; apiKey: string | null }> {
  const projectId = toolCtx?.requestContext?.get('projectId') as string | undefined;
  const { key } = await resolveKey('linear', projectId);
  if (!key) return { client: null, apiKey: null };
  return { client: new LinearClient({ apiKey: key }), apiKey: key };
}

// Field allowlist for update operations (M1)
const ALLOWED_UPDATE_FIELDS = ['title', 'description', 'priority', 'assigneeId', 'stateId', 'labelIds'];

// ---------- Tool 1: createLinearIssue ----------
const _createLinearIssue = createTool({
  id: 'create-linear-issue',
  description: 'Create a new Linear issue. Team ID is auto-configured — do NOT ask the user for it. Provide: title, description, priority (0-4), optional assigneeId, labelIds, stateId.',
  inputSchema: ticketCreateSchema,
  execute: async (
    input: { context: Record<string, unknown> } | Record<string, unknown>,
    toolCtx?: ToolCtx,
  ) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    const { client: linearClient } = await resolveLinearClient(toolCtx);
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const issueInput: Record<string, unknown> = {
        teamId: ((ctx as Record<string, unknown>).teamId as string) || LINEAR_CONSTANTS.TEAM_ID,
        title: (ctx as Record<string, unknown>).title as string,
        description: (ctx as Record<string, unknown>).description as string,
        priority: (ctx as Record<string, unknown>).priority as number,
        assigneeId: (ctx as Record<string, unknown>).assigneeId as string | undefined,
        labelIds: (ctx as Record<string, unknown>).labelIds as string[] | undefined,
        stateId: (ctx as Record<string, unknown>).stateId as string | undefined,
      };
      if ((ctx as Record<string, unknown>).cycleId) {
        issueInput.cycleId = (ctx as Record<string, unknown>).cycleId as string;
      }
      const result = await linearClient.createIssue(issueInput as Parameters<typeof linearClient.createIssue>[0]);
      const issue = await result.issue;
      if (!issue) {
        return { success: false, error: 'Linear API returned no issue data' };
      }
      return {
        success: true,
        data: {
          id: issue.id,
          identifier: issue.identifier,
          url: issue.url,
          title: issue.title,
        },
      };
    } catch (error: unknown) {
      console.error('[Linear] API error:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown error');
      return { success: false, error: `Linear API error: ${error instanceof Error ? error.message.slice(0, 200) : 'Unknown error'}` };
    }
  },
});
// Human-in-the-loop approval happens at the UI level (triage card → user confirms)
export const createLinearIssue = _createLinearIssue;

// ---------- Tool 2: updateLinearIssue ----------
export const updateLinearIssue = createTool({
  id: 'update-linear-issue',
  description: 'Update fields on an existing Linear issue (status, assignee, priority, labels).',
  inputSchema: ticketUpdateSchema,
  execute: async (
    input: { context: Record<string, unknown> } | Record<string, unknown>,
    toolCtx?: ToolCtx,
  ) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    const { client: linearClient } = await resolveLinearClient(toolCtx);
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const { issueId } = ctx as Record<string, unknown>;
      const cleanFields: Record<string, unknown> = {};
      for (const key of ALLOWED_UPDATE_FIELDS) {
        if ((ctx as Record<string, unknown>)[key] !== undefined) cleanFields[key] = (ctx as Record<string, unknown>)[key];
      }
      const result = await linearClient.updateIssue(issueId as string, cleanFields);
      const issue = await result.issue;
      if (!issue) {
        return { success: false, error: 'Linear API returned no issue data' };
      }
      return {
        success: true,
        data: {
          id: issue.id,
          identifier: issue.identifier,
          url: issue.url,
        },
      };
    } catch (error: unknown) {
      console.error('[Linear] API error:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown error');
      return { success: false, error: `Linear API error: ${error instanceof Error ? error.message.slice(0, 200) : 'Unknown error'}` };
    }
  },
});

// ---------- Tool 3: getLinearIssue ----------
export const getLinearIssue = createTool({
  id: 'get-linear-issue',
  description: 'Get a Linear issue by ID or shorthand identifier (e.g. TRI-123).',
  inputSchema: issueIdInputSchema,
  execute: async (
    input: { context: Record<string, unknown> } | Record<string, unknown>,
    toolCtx?: ToolCtx,
  ) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    const { client: linearClient } = await resolveLinearClient(toolCtx);
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const issue = await linearClient.issue((ctx as Record<string, unknown>).issueId as string);
      const state = await issue.state;
      if (!state) {
        return { success: false, error: 'Issue state not available' };
      }
      const assignee = await issue.assignee;
      const labelsResult = await issue.labels();
      const labels = labelsResult.nodes.map((l: { id: string; name: string }) => ({ id: l.id, name: l.name }));

      return {
        success: true,
        data: {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description,
          state: { id: state.id, name: state.name, type: state.type },
          assignee: assignee ? { id: assignee.id, name: assignee.name, email: assignee.email } : null,
          labels,
          priority: issue.priority,
          url: issue.url,
          createdAt: issue.createdAt instanceof Date ? issue.createdAt.toISOString() : String(issue.createdAt ?? ''),
          updatedAt: issue.updatedAt instanceof Date ? issue.updatedAt.toISOString() : String(issue.updatedAt ?? ''),
        },
      };
    } catch (error: unknown) {
      console.error('[Linear] API error:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown error');
      return { success: false, error: `Linear API error: ${error instanceof Error ? error.message.slice(0, 200) : 'Unknown error'}` };
    }
  },
});

// ---------- Tool 4: searchLinearIssues ----------
export const searchLinearIssues = createTool({
  id: 'search-linear-issues',
  description: 'Search Linear issues by title, status, assignee, or labels. Team is auto-configured. Use for duplicate detection.',
  inputSchema: issueSearchSchema,
  execute: async (
    input: { context: Record<string, unknown> } | Record<string, unknown>,
    toolCtx?: ToolCtx,
  ) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    const { client: linearClient } = await resolveLinearClient(toolCtx);
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const filter: Record<string, unknown> = {};
      if ((ctx as Record<string, unknown>).query) filter.title = { containsIgnoreCase: (ctx as Record<string, unknown>).query };
      filter.team = { id: { eq: ((ctx as Record<string, unknown>).teamId as string) || LINEAR_CONSTANTS.TEAM_ID } };
      if ((ctx as Record<string, unknown>).assigneeId) filter.assignee = { id: { eq: (ctx as Record<string, unknown>).assigneeId } };
      if ((ctx as Record<string, unknown>).priority !== undefined) filter.priority = { eq: (ctx as Record<string, unknown>).priority };
      if ((ctx as Record<string, unknown>).status) filter.state = { name: { eq: (ctx as Record<string, unknown>).status } };
      if ((ctx as Record<string, unknown>).labels) filter.labels = { name: { in: (ctx as Record<string, unknown>).labels } };

      const limit = Math.min(((ctx as Record<string, unknown>).limit as number) ?? 10, 50);
      const result = await linearClient.issues({ filter, first: limit });

      const issues = await Promise.all(
        result.nodes.map(async (issue) => {
          const state = await issue.state;
          return {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            state: state ? { id: state.id, name: state.name } : null,
            priority: issue.priority,
            url: issue.url,
          };
        }),
      );

      return {
        success: true,
        data: {
          issues,
          returnedCount: issues.length,
          hasNextPage: result.pageInfo?.hasNextPage ?? false,
        },
      };
    } catch (error: unknown) {
      console.error('[Linear] API error:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown error');
      return { success: false, error: `Linear API error: ${error instanceof Error ? error.message.slice(0, 200) : 'Unknown error'}` };
    }
  },
});

// ---------- Tool 5: getLinearTeamMembers ----------
export const getLinearTeamMembers = createTool({
  id: 'get-linear-team-members',
  description: 'Get all members of the Linear team. Team ID is auto-configured — do NOT ask for it.',
  inputSchema: teamIdInputSchema,
  execute: async (
    input: { context: Record<string, unknown> } | Record<string, unknown>,
    toolCtx?: ToolCtx,
  ) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    const { client: linearClient } = await resolveLinearClient(toolCtx);
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const team = await linearClient.team(((ctx as Record<string, unknown>).teamId as string) || LINEAR_CONSTANTS.TEAM_ID);
      const members = await team.members();

      const humanMembers = members.nodes.filter((m: { id: string; name: string; email: string; displayName: string; isBot?: boolean }) => {
        if (m.isBot) return false;
        if (!m.email) return false;
        if (m.email.includes('@linear.linear.app')) return false;
        if (m.email.includes('@oauthapp.linear.app')) return false;
        return true;
      });

      return {
        success: true,
        data: {
          members: humanMembers.map((m: { id: string; name: string; email: string; displayName: string }) => ({
            id: m.id,
            name: m.name,
            email: m.email,
            displayName: m.displayName,
          })),
        },
      };
    } catch (error: unknown) {
      console.error('[Linear] API error:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown error');
      return { success: false, error: `Linear API error: ${error instanceof Error ? error.message.slice(0, 200) : 'Unknown error'}` };
    }
  },
});

// ---------- Tool 6: listLinearCycles ----------
export const listLinearCycles = createTool({
  id: 'list-linear-cycles',
  description: 'List Linear cycles (sprints) for the team. Returns active and upcoming cycles so the agent can ask the user which cycle to assign an issue to.',
  inputSchema: z.object({
    includeCompleted: z.boolean().optional().describe('Include completed cycles (default: false)'),
  }),
  execute: async (
    input: { context: Record<string, unknown> } | Record<string, unknown>,
    toolCtx?: ToolCtx,
  ) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    const { client: linearClient } = await resolveLinearClient(toolCtx);
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const team = await linearClient.team(LINEAR_CONSTANTS.TEAM_ID);
      const includeCompleted = (ctx as Record<string, unknown>).includeCompleted === true;
      const filter = includeCompleted ? {} : { isActive: { eq: true } };
      const cyclesConnection = await team.cycles({ filter, first: 10 });

      return {
        success: true,
        data: {
          cycles: cyclesConnection.nodes.map((c) => ({
            id: c.id,
            name: c.name ?? `Cycle ${c.number}`,
            number: c.number,
            startsAt: c.startsAt?.toISOString?.() ?? String(c.startsAt ?? ''),
            endsAt: c.endsAt?.toISOString?.() ?? String(c.endsAt ?? ''),
            progress: c.progress ?? 0,
          })),
        },
      };
    } catch (error: unknown) {
      console.error('[Linear] API error:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown error');
      return { success: false, error: `Linear API error: ${error instanceof Error ? error.message.slice(0, 200) : 'Unknown error'}` };
    }
  },
});

// ---------- Tool 7: getLinearIssueComments ----------
export const getLinearIssueComments = createTool({
  id: 'get-linear-issue-comments',
  description: 'Fetch all comments on a Linear issue. Used by the In Review evidence check to determine whether a ticket has human-provided evidence of completion.',
  inputSchema: issueIdInputSchema,
  execute: async (
    input: { context: Record<string, unknown> } | Record<string, unknown>,
    toolCtx?: ToolCtx,
  ) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    const { client: linearClient } = await resolveLinearClient(toolCtx);
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const issue = await linearClient.issue((ctx as Record<string, unknown>).issueId as string);
      const commentsConnection = await issue.comments();
      const comments = await Promise.all(
        commentsConnection.nodes.map(async (c) => {
          let userInfo: { name: string | null; email: string | null } = { name: null, email: null };
          try {
            const user = await c.user;
            if (user) {
              userInfo = { name: user.name ?? null, email: user.email ?? null };
            }
          } catch { /* user may not be resolvable */ }
          return {
            id: c.id,
            body: c.body ?? '',
            user: userInfo,
            createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt ?? ''),
          };
        }),
      );
      return { success: true, data: { comments } };
    } catch (error: unknown) {
      console.error('[Linear] API error:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown error');
      return { success: false, error: `Linear API error: ${error instanceof Error ? error.message.slice(0, 200) : 'Unknown error'}` };
    }
  },
});

// ============================================================
// Aliases for Lalo's agent registrations
// The orchestrator agent references tools by these names.
// ============================================================
export const createLinearIssueTool = createLinearIssue;
export const updateLinearIssueTool = updateLinearIssue;
export const getLinearIssueTool = getLinearIssue;
export const listLinearIssuesTool = searchLinearIssues;
export const getTeamMembersTool = getLinearTeamMembers;
export const listLinearCyclesTool = listLinearCycles;
export const getLinearIssueCommentsTool = getLinearIssueComments;
