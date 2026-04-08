import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { LinearClient } from '@linear/sdk';
import { config } from '../../lib/config';
import { ticketCreateSchema, ticketUpdateSchema, issueSearchSchema } from '../../lib/schemas/ticket';

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
  execute: async (input: any) => {
    const ctx = input?.context ?? input;
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const result = await linearClient.createIssue({
        teamId: ctx.teamId,
        title: ctx.title,
        description: ctx.description,
        priority: ctx.priority,
        assigneeId: ctx.assigneeId,
        labelIds: ctx.labelIds,
        stateId: ctx.stateId,
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
    } catch (error: any) {
      console.error('[Linear] API error:', error);
      return { success: false, error: `Linear API error: ${error.message}` };
    }
  },
});

// ---------- Tool 2: updateLinearIssue ----------
export const updateLinearIssue = createTool({
  id: 'update-linear-issue',
  description: 'Update fields on an existing Linear issue (status, assignee, priority, labels).',
  inputSchema: ticketUpdateSchema,
  execute: async (input: any) => {
    const ctx = input?.context ?? input;
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const { issueId } = ctx;
      const cleanFields: Record<string, unknown> = {};
      for (const key of ALLOWED_UPDATE_FIELDS) {
        if (ctx[key] !== undefined) cleanFields[key] = ctx[key];
      }
      const result = await linearClient.updateIssue(issueId, cleanFields);
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
    } catch (error: any) {
      console.error('[Linear] API error:', error);
      return { success: false, error: `Linear API error: ${error.message}` };
    }
  },
});

// ---------- Tool 3: getLinearIssue ----------
export const getLinearIssue = createTool({
  id: 'get-linear-issue',
  description: 'Get a Linear issue by ID or shorthand identifier (e.g. TRI-123).',
  inputSchema: z.object({ issueId: z.string().min(1) }),
  execute: async (input: any) => {
    const ctx = input?.context ?? input;
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const issue = await linearClient.issue(ctx.issueId);
      const state = await issue.state;
      const assignee = await issue.assignee;
      const labelsResult = await issue.labels();
      const labels = labelsResult.nodes.map((l: any) => ({ id: l.id, name: l.name }));

      return {
        success: true,
        data: {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description,
          state: state ? { id: state.id, name: state.name, type: (state as any).type } : null,
          assignee: assignee ? { id: assignee.id, name: assignee.name, email: assignee.email } : null,
          labels,
          priority: issue.priority,
          url: issue.url,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
        },
      };
    } catch (error: any) {
      console.error('[Linear] API error:', error);
      return { success: false, error: `Linear API error: ${error.message}` };
    }
  },
});

// ---------- Tool 4: searchLinearIssues ----------
export const searchLinearIssues = createTool({
  id: 'search-linear-issues',
  description: 'Search Linear issues by title, status, assignee, or labels. Use for duplicate detection.',
  inputSchema: issueSearchSchema,
  execute: async (input: any) => {
    const ctx = input?.context ?? input;
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const filter: Record<string, unknown> = {};
      if (ctx.query) filter.title = { containsIgnoreCase: ctx.query };
      if (ctx.teamId) filter.team = { id: { eq: ctx.teamId } };
      if (ctx.assigneeId) filter.assignee = { id: { eq: ctx.assigneeId } };
      if (ctx.priority !== undefined) filter.priority = { eq: ctx.priority };
      if (ctx.status) filter.state = { name: { eq: ctx.status } };
      if (ctx.labels) filter.labels = { name: { in: ctx.labels } };

      const limit = Math.min(ctx.limit ?? 10, 50);
      const result = await linearClient.issues({ filter, first: limit });

      const issues = await Promise.all(
        result.nodes.map(async (issue: any) => {
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
    } catch (error: any) {
      console.error('[Linear] API error:', error);
      return { success: false, error: `Linear API error: ${error.message}` };
    }
  },
});

// ---------- Tool 5: getLinearTeamMembers ----------
export const getLinearTeamMembers = createTool({
  id: 'get-linear-team-members',
  description: 'Get all members of a Linear team. Use for auto-assignment decisions.',
  inputSchema: z.object({ teamId: z.string().min(1) }),
  execute: async (input: any) => {
    const ctx = input?.context ?? input;
    if (!linearClient) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    try {
      const team = await linearClient.team(ctx.teamId);
      const members = await team.members();

      const humanMembers = members.nodes.filter((m: any) => {
        if (m.isBot) return false;
        if (!m.email) return false;
        if (m.email.includes('@linear.linear.app')) return false;
        if (m.email.includes('@oauthapp.linear.app')) return false;
        return true;
      });

      return {
        success: true,
        data: {
          members: humanMembers.map((m: any) => ({
            id: m.id,
            name: m.name,
            email: m.email,
            displayName: m.displayName,
          })),
        },
      };
    } catch (error: any) {
      console.error('[Linear] API error:', error);
      return { success: false, error: `Linear API error: ${error.message}` };
    }
  },
});
