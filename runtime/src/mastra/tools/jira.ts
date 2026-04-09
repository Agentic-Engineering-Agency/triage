/**
 * Jira Cloud integration tools (6 tools).
 *
 * Mirrors the Linear tools pattern (linear.ts):
 *   - Module-level singleton client (graceful null when not configured)
 *   - Mastra createTool wrappers with zod schemas
 *   - Consistent { success, data } / { success, error } return shape
 *   - Human-in-the-loop approval for create/update/transition
 *
 * Uses jira.js Version3Client (REST API v3, ADF format).
 */

import { createTool } from '@mastra/core/tools';
import { Version3Client, Version3Parameters } from 'jira.js';
import { config } from '../../lib/config';
import { textToAdf } from '../../lib/adf';
import {
  jiraIssueCreateSchema,
  jiraIssueUpdateSchema,
  jiraIssueKeySchema,
  jiraTransitionSchema,
  jiraCommentSchema,
  jiraSearchSchema,
} from '../../lib/schemas/jira';

// ============================================================
// Module-level singleton (mirrors Linear pattern)
// ============================================================

const jiraClient: InstanceType<typeof Version3Client> | null =
  config.JIRA_API_TOKEN && config.JIRA_BASE_URL && config.JIRA_EMAIL
    ? new Version3Client({
        host: config.JIRA_BASE_URL,
        authentication: {
          basic: {
            email: config.JIRA_EMAIL,
            apiToken: config.JIRA_API_TOKEN,
          },
        },
      })
    : null;

// Default fields to request on search/get
const DEFAULT_FIELDS = [
  'summary',
  'status',
  'priority',
  'assignee',
  'labels',
  'issuetype',
  'description',
  'created',
  'updated',
  'reporter',
];

// ============================================================
// Tool 1: createJiraIssue
// ============================================================
export const createJiraIssue = createTool({
  id: 'create-jira-issue',
  description: 'Create a new Jira issue with summary, description, priority, labels, and assignee.',
  inputSchema: jiraIssueCreateSchema,
  requireApproval: true,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    if (!jiraClient) {
      return { success: false, error: 'JIRA_API_TOKEN not configured' };
    }
    try {
      const fields: Record<string, unknown> = {
        project: { key: (ctx as Record<string, unknown>).projectKey || 'KAN' },
        summary: (ctx as Record<string, unknown>).summary as string,
        issuetype: { name: (ctx as Record<string, unknown>).issueType || 'Task' },
      };

      const description = (ctx as Record<string, unknown>).description as string | undefined;
      if (description) {
        fields.description = textToAdf(description);
      }

      const priority = (ctx as Record<string, unknown>).priority as string | undefined;
      if (priority) {
        fields.priority = { name: priority };
      }

      const labels = (ctx as Record<string, unknown>).labels as string[] | undefined;
      if (labels) {
        fields.labels = labels;
      }

      const assignee = (ctx as Record<string, unknown>).assigneeAccountId as string | undefined;
      if (assignee) {
        fields.assignee = { id: assignee };
      }

      const parentKey = (ctx as Record<string, unknown>).parentKey as string | undefined;
      if (parentKey) {
        fields.parent = { key: parentKey };
      }

      // Cast fields to the expected type — we build it dynamically but it satisfies
      // the CreateIssue interface at runtime (project, summary, issuetype are always set).
      const result = await jiraClient.issues.createIssue({
        fields: fields as Version3Parameters.CreateIssue['fields'],
      });
      return {
        success: true,
        data: {
          id: result.id,
          key: result.key,
          self: result.self,
        },
      };
    } catch (error: unknown) {
      console.error('[Jira] Create error:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown');
      return { success: false, error: `Jira API error: ${error instanceof Error ? error.message.slice(0, 200) : 'Unknown'}` };
    }
  },
});

// ============================================================
// Tool 2: getJiraIssue
// ============================================================
export const getJiraIssue = createTool({
  id: 'get-jira-issue',
  description: 'Get a Jira issue by key (e.g. KAN-42). Returns full issue details.',
  inputSchema: jiraIssueKeySchema,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    if (!jiraClient) {
      return { success: false, error: 'JIRA_API_TOKEN not configured' };
    }
    try {
      const issue = await jiraClient.issues.getIssue({
        issueIdOrKey: (ctx as Record<string, unknown>).issueKey as string,
        fields: DEFAULT_FIELDS,
      });

      const fields = issue.fields as Record<string, unknown>;
      const status = fields.status as Record<string, unknown> | null;
      const priority = fields.priority as Record<string, unknown> | null;
      const assignee = fields.assignee as Record<string, unknown> | null;
      const reporter = fields.reporter as Record<string, unknown> | null;
      const issuetype = fields.issuetype as Record<string, unknown> | null;

      return {
        success: true,
        data: {
          id: issue.id,
          key: issue.key,
          self: issue.self,
          summary: fields.summary,
          description: fields.description || null,
          status: status ? { id: (status as Record<string, unknown>).id, name: (status as Record<string, unknown>).name } : null,
          priority: priority ? { id: (priority as Record<string, unknown>).id, name: (priority as Record<string, unknown>).name } : null,
          assignee: assignee
            ? {
                accountId: (assignee as Record<string, unknown>).accountId,
                displayName: (assignee as Record<string, unknown>).displayName,
                emailAddress: (assignee as Record<string, unknown>).emailAddress,
              }
            : null,
          reporter: reporter
            ? {
                accountId: (reporter as Record<string, unknown>).accountId,
                displayName: (reporter as Record<string, unknown>).displayName,
              }
            : null,
          issuetype: issuetype ? { id: (issuetype as Record<string, unknown>).id, name: (issuetype as Record<string, unknown>).name } : null,
          labels: (fields.labels as string[]) || [],
          created: fields.created as string,
          updated: fields.updated as string,
        },
      };
    } catch (error: unknown) {
      console.error('[Jira] Get error:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown');
      return { success: false, error: `Jira API error: ${error instanceof Error ? error.message.slice(0, 200) : 'Unknown'}` };
    }
  },
});

// ============================================================
// Tool 3: updateJiraIssue
// ============================================================
export const updateJiraIssue = createTool({
  id: 'update-jira-issue',
  description: 'Update fields on an existing Jira issue (summary, description, priority, labels, assignee).',
  inputSchema: jiraIssueUpdateSchema,
  requireApproval: true,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    if (!jiraClient) {
      return { success: false, error: 'JIRA_API_TOKEN not configured' };
    }
    try {
      const fields: Record<string, unknown> = {};

      const summary = (ctx as Record<string, unknown>).summary as string | undefined;
      if (summary !== undefined) fields.summary = summary;

      const description = (ctx as Record<string, unknown>).description as string | undefined;
      if (description !== undefined) fields.description = textToAdf(description);

      const priority = (ctx as Record<string, unknown>).priority as string | undefined;
      if (priority !== undefined) fields.priority = { name: priority };

      const labels = (ctx as Record<string, unknown>).labels as string[] | undefined;
      if (labels !== undefined) fields.labels = labels;

      const assignee = (ctx as Record<string, unknown>).assigneeAccountId as string | undefined;
      if (assignee !== undefined) fields.assignee = { accountId: assignee };

      await jiraClient.issues.editIssue({
        issueIdOrKey: (ctx as Record<string, unknown>).issueKey as string,
        fields,
      });

      return {
        success: true,
        data: {
          issueKey: (ctx as Record<string, unknown>).issueKey,
          updatedFields: Object.keys(fields),
        },
      };
    } catch (error: unknown) {
      console.error('[Jira] Update error:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown');
      return { success: false, error: `Jira API error: ${error instanceof Error ? error.message.slice(0, 200) : 'Unknown'}` };
    }
  },
});

// ============================================================
// Tool 4: transitionJiraIssue
// ============================================================
export const transitionJiraIssue = createTool({
  id: 'transition-jira-issue',
  description: 'Transition a Jira issue to a new status (11=Todo, 21=InProgress, 31=InReview, 41=Backlog, 51=Done).',
  inputSchema: jiraTransitionSchema,
  requireApproval: true,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    if (!jiraClient) {
      return { success: false, error: 'JIRA_API_TOKEN not configured' };
    }
    try {
      await jiraClient.issues.doTransition({
        issueIdOrKey: (ctx as Record<string, unknown>).issueKey as string,
        transition: { id: (ctx as Record<string, unknown>).transitionId as string },
      });

      return {
        success: true,
        data: {
          issueKey: (ctx as Record<string, unknown>).issueKey,
          transitionId: (ctx as Record<string, unknown>).transitionId,
        },
      };
    } catch (error: unknown) {
      console.error('[Jira] Transition error:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown');
      return { success: false, error: `Jira API error: ${error instanceof Error ? error.message.slice(0, 200) : 'Unknown'}` };
    }
  },
});

// ============================================================
// Tool 5: addJiraComment
// ============================================================
export const addJiraComment = createTool({
  id: 'add-jira-comment',
  description: 'Add a comment to a Jira issue.',
  inputSchema: jiraCommentSchema,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    if (!jiraClient) {
      return { success: false, error: 'JIRA_API_TOKEN not configured' };
    }
    try {
      const result = await jiraClient.issueComments.addComment({
        issueIdOrKey: (ctx as Record<string, unknown>).issueKey as string,
        comment: textToAdf((ctx as Record<string, unknown>).body as string) as any,
      });

      return {
        success: true,
        data: {
          id: (result as any).id,
          issueKey: (ctx as Record<string, unknown>).issueKey,
          created: (result as any).created,
        },
      };
    } catch (error: unknown) {
      console.error('[Jira] Comment error:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown');
      return { success: false, error: `Jira API error: ${error instanceof Error ? error.message.slice(0, 200) : 'Unknown'}` };
    }
  },
});

// ============================================================
// Tool 6: searchJiraIssues
// ============================================================
export const searchJiraIssues = createTool({
  id: 'search-jira-issues',
  description: 'Search Jira issues using JQL. Use for querying, filtering, and duplicate detection.',
  inputSchema: jiraSearchSchema,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input as Record<string, unknown>)?.context ?? input;
    if (!jiraClient) {
      return { success: false, error: 'JIRA_API_TOKEN not configured' };
    }
    try {
      const fields = ((ctx as Record<string, unknown>).fields as string[] | undefined) || DEFAULT_FIELDS;
      const maxResults = Math.min(((ctx as Record<string, unknown>).maxResults as number) ?? 20, 100);

      // NOTE: searchForIssuesUsingJql returns HTTP 410 (Gone) on next-gen Jira Cloud
      // projects. Use the enhanced search endpoint instead.
      const result = await jiraClient.issueSearch.searchForIssuesUsingJqlEnhancedSearchPost({
        jql: (ctx as Record<string, unknown>).jql as string,
        maxResults,
        fields,
      }) as any;

      const issues = (result.issues || []).map((issue) => {
        const f = issue.fields as Record<string, unknown>;
        const status = f.status as Record<string, unknown> | null;
        const priority = f.priority as Record<string, unknown> | null;
        const assignee = f.assignee as Record<string, unknown> | null;
        const issuetype = f.issuetype as Record<string, unknown> | null;

        return {
          id: issue.id,
          key: issue.key,
          summary: f.summary,
          status: status ? { id: (status as Record<string, unknown>).id, name: (status as Record<string, unknown>).name } : null,
          priority: priority ? { id: (priority as Record<string, unknown>).id, name: (priority as Record<string, unknown>).name } : null,
          assignee: assignee ? { accountId: (assignee as Record<string, unknown>).accountId, displayName: (assignee as Record<string, unknown>).displayName } : null,
          issuetype: issuetype ? { name: (issuetype as Record<string, unknown>).name } : null,
          labels: (f.labels as string[]) || [],
        };
      });

      return {
        success: true,
        data: {
          issues,
          total: result.total ?? 0,
          returnedCount: issues.length,
          maxResults,
        },
      };
    } catch (error: unknown) {
      console.error('[Jira] Search error:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown');
      return { success: false, error: `Jira API error: ${error instanceof Error ? error.message.slice(0, 200) : 'Unknown'}` };
    }
  },
});

// ============================================================
// Aliases for agent registrations (mirrors Linear pattern)
// ============================================================
export const createJiraIssueTool = createJiraIssue;
export const getJiraIssueTool = getJiraIssue;
export const updateJiraIssueTool = updateJiraIssue;
export const transitionJiraIssueTool = transitionJiraIssue;
export const addJiraCommentTool = addJiraComment;
export const searchJiraIssuesTool = searchJiraIssues;
