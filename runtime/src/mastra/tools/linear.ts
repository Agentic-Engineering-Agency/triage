import { createTool } from '@mastra/core/tools';
import { LinearClient } from '@linear/sdk';
import { config } from '../../lib/config';
import {
  ticketCreateSchema,
  ticketUpdateSchema,
  issueSearchSchema,
  issueIdInputSchema,
  teamIdInputSchema,
} from '../../lib/schemas/ticket';

// Module-level singleton (REQ-5)
const linearClient: InstanceType<typeof LinearClient> | null = config.LINEAR_API_KEY
  ? new LinearClient({ apiKey: config.LINEAR_API_KEY })
  : null;

// Field allowlist for update operations (M1)
const ALLOWED_UPDATE_FIELDS = ['title', 'description', 'priority', 'assigneeId', 'stateId', 'labelIds'];

// ---------- Tool 1: createLinearIssue ----------
export const createLinearIssue = createTool({
  id: 'create-linear-issue',
  description: 'Create a new Linear issue with title, description, priority, and optional assignee/labels.',
  inputSchema: ticketCreateSchema,
  requireApproval: true,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const result = await linearClient.createIssue({
        teamId: (ctx as Record<string, unknown>).teamId as string,
        title: (ctx as Record<string, unknown>).title as string,
        description: (ctx as Record<string, unknown>).description as string,
        priority: (ctx as Record<string, unknown>).priority as number,
        assigneeId: (ctx as Record<string, unknown>).assigneeId as string | undefined,
        labelIds: (ctx as Record<string, unknown>).labelIds as string[] | undefined,
        stateId: (ctx as Record<string, unknown>).stateId as string | undefined,
      });
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

// ---------- Tool 2: updateLinearIssue ----------
export const updateLinearIssue = createTool({
  id: 'update-linear-issue',
  description: 'Update fields on an existing Linear issue (status, assignee, priority, labels).',
  inputSchema: ticketUpdateSchema,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
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
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const issue = await linearClient.issue((ctx as Record<string, unknown>).issueId as string);
      const state = await issue.state;
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
          state: state ? { id: state.id, name: state.name, type: ((state as Record<string, unknown>).type as string) ?? 'unknown' } : null,
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
  description: 'Search Linear issues by title, status, assignee, or labels. Use for duplicate detection.',
  inputSchema: issueSearchSchema,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const filter: Record<string, unknown> = {};
      if ((ctx as Record<string, unknown>).query) filter.title = { containsIgnoreCase: (ctx as Record<string, unknown>).query };
      if ((ctx as Record<string, unknown>).teamId) filter.team = { id: { eq: (ctx as Record<string, unknown>).teamId } };
      if ((ctx as Record<string, unknown>).assigneeId) filter.assignee = { id: { eq: (ctx as Record<string, unknown>).assigneeId } };
      if ((ctx as Record<string, unknown>).priority !== undefined) filter.priority = { eq: (ctx as Record<string, unknown>).priority };
      if ((ctx as Record<string, unknown>).status) filter.state = { name: { eq: (ctx as Record<string, unknown>).status } };
      if ((ctx as Record<string, unknown>).labels) filter.labels = { name: { in: (ctx as Record<string, unknown>).labels } };

      const limit = Math.min(((ctx as Record<string, unknown>).limit as number) ?? 10, 50);
      const result = await linearClient.issues({ filter, first: limit });

      const issues = await Promise.all(
        result.nodes.map(async (issue: { id: string; identifier: string; title: string; state: Promise<{ id: string; name: string } | undefined>; priority: number; url: string }) => {
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
          totalCount: issues.length,
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
  description: 'Get all members of a Linear team. Use for auto-assignment decisions.',
  inputSchema: teamIdInputSchema,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const team = await linearClient.team((ctx as Record<string, unknown>).teamId as string);
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
