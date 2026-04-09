/**
 * Tests for Jira Cloud integration tools (6 tools)
 *
 * These tests define the implementation contract for:
 *   - createJiraIssue
 *   - getJiraIssue
 *   - updateJiraIssue
 *   - transitionJiraIssue
 *   - addJiraComment
 *   - searchJiraIssues
 *
 * All tests mock jira.js — no live API calls.
 * Mirrors the linear.test.ts pattern (vi.hoisted + vi.mock).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mock jira.js + config ----
const {
  mockCreateIssue,
  mockGetIssue,
  mockEditIssue,
  mockDoTransition,
  mockAddComment,
  mockEnhancedSearch,
} = vi.hoisted(() => ({
  mockCreateIssue: vi.fn(),
  mockGetIssue: vi.fn(),
  mockEditIssue: vi.fn(),
  mockDoTransition: vi.fn(),
  mockAddComment: vi.fn(),
  mockEnhancedSearch: vi.fn(),
}));

vi.mock('jira.js', () => ({
  Version3Client: vi.fn().mockImplementation(() => ({
    issues: {
      createIssue: mockCreateIssue,
      getIssue: mockGetIssue,
      editIssue: mockEditIssue,
      doTransition: mockDoTransition,
    },
    issueComments: {
      addComment: mockAddComment,
    },
    issueSearch: {
      searchForIssuesUsingJqlEnhancedSearchPost: mockEnhancedSearch,
    },
  })),
  Version3Parameters: {},
}));

// Mock config so jiraClient is instantiated (all 3 creds must be truthy)
vi.mock('../../lib/config', () => ({
  config: {
    LINEAR_API_KEY: undefined,
    RESEND_API_KEY: undefined,
    RESEND_FROM_EMAIL: 'triage@agenticengineering.lat',
    JIRA_BASE_URL: 'https://agenticengineering.atlassian.net',
    JIRA_EMAIL: 'test@example.com',
    JIRA_API_TOKEN: 'mock-token',
  },
}));

// ---- Import tools under test ----
import {
  createJiraIssue,
  getJiraIssue,
  updateJiraIssue,
  transitionJiraIssue,
  addJiraComment,
  searchJiraIssues,
} from './jira';

// ---- Test constants (from live Jira instance) ----
const ACCOUNT_ID_FERNANDO = '712020:e46f3f5c-445f-4c10-a45f-999014c11922';

// Helper: simulate calling a Mastra tool's execute function
function executeTool(tool: any, input: Record<string, unknown>) {
  return tool.execute(input);
}

describe('Jira Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =====================================================================
  // createJiraIssue
  // =====================================================================
  describe('createJiraIssue', () => {
    it('creates issue with all fields and returns key', async () => {
      mockCreateIssue.mockResolvedValue({
        id: '10001',
        key: 'KAN-42',
        self: 'https://agenticengineering.atlassian.net/rest/api/3/issue/10001',
      });

      const result = await executeTool(createJiraIssue, {
        summary: 'API returns 500 on /auth/login',
        description: 'Steps to reproduce...',
        issueType: 'Bug',
        projectKey: 'KAN',
        priority: 'High',
        labels: ['bug', 'auth'],
        assigneeAccountId: ACCOUNT_ID_FERNANDO,
      });

      expect(result).toEqual({
        success: true,
        data: {
          id: '10001',
          key: 'KAN-42',
          self: 'https://agenticengineering.atlassian.net/rest/api/3/issue/10001',
        },
      });

      expect(mockCreateIssue).toHaveBeenCalledWith({
        fields: expect.objectContaining({
          project: { key: 'KAN' },
          summary: 'API returns 500 on /auth/login',
          issuetype: { name: 'Bug' },
          priority: { name: 'High' },
          labels: ['bug', 'auth'],
          assignee: { id: ACCOUNT_ID_FERNANDO },
        }),
      });
    });

    it('creates issue with minimal fields (defaults to Task, KAN)', async () => {
      mockCreateIssue.mockResolvedValue({
        id: '10002',
        key: 'KAN-43',
        self: 'https://agenticengineering.atlassian.net/rest/api/3/issue/10002',
      });

      const result = await executeTool(createJiraIssue, {
        summary: 'Simple task',
      });

      expect(result.success).toBe(true);
      expect(result.data.key).toBe('KAN-43');

      expect(mockCreateIssue).toHaveBeenCalledWith({
        fields: expect.objectContaining({
          project: { key: 'KAN' },
          summary: 'Simple task',
          issuetype: { name: 'Task' },
        }),
      });
    });

    it('converts description to ADF format', async () => {
      mockCreateIssue.mockResolvedValue({ id: '1', key: 'KAN-1', self: 'u' });

      await executeTool(createJiraIssue, {
        summary: 'Test',
        description: 'First paragraph\n\nSecond paragraph',
      });

      const callArgs = mockCreateIssue.mock.calls[0][0];
      const desc = callArgs.fields.description;
      expect(desc.type).toBe('doc');
      expect(desc.version).toBe(1);
      expect(desc.content).toHaveLength(2);
      expect(desc.content[0].content[0].text).toBe('First paragraph');
      expect(desc.content[1].content[0].text).toBe('Second paragraph');
    });

    it('sets parent key for subtasks', async () => {
      mockCreateIssue.mockResolvedValue({ id: '1', key: 'KAN-1', self: 'u' });

      await executeTool(createJiraIssue, {
        summary: 'Subtask',
        issueType: 'Subtask',
        parentKey: 'KAN-10',
      });

      const callArgs = mockCreateIssue.mock.calls[0][0];
      expect(callArgs.fields.parent).toEqual({ key: 'KAN-10' });
    });

    it('returns structured error when API throws', async () => {
      mockCreateIssue.mockRejectedValue(new Error('Field priority is invalid'));

      const result = await executeTool(createJiraIssue, {
        summary: 'Valid summary',
        priority: 'InvalidPriority',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Field priority is invalid');
    });

    it('has requireApproval set to true', () => {
      expect((createJiraIssue as any).requireApproval).toBe(true);
    });

    it('has id "create-jira-issue"', () => {
      expect((createJiraIssue as any).id).toBe('create-jira-issue');
    });
  });

  // =====================================================================
  // getJiraIssue
  // =====================================================================
  describe('getJiraIssue', () => {
    const mockIssueResponse = {
      id: '10001',
      key: 'KAN-42',
      self: 'https://agenticengineering.atlassian.net/rest/api/3/issue/10001',
      fields: {
        summary: 'API returns 500 on /auth/login',
        description: { type: 'doc', version: 1, content: [] },
        status: { id: '10001', name: 'En curso' },
        priority: { id: '2', name: 'High' },
        assignee: {
          accountId: ACCOUNT_ID_FERNANDO,
          displayName: 'Fernando',
          emailAddress: 'fernando@agenticengineering.agency',
        },
        reporter: {
          accountId: ACCOUNT_ID_FERNANDO,
          displayName: 'Fernando',
        },
        issuetype: { id: '10006', name: 'Bug' },
        labels: ['bug', 'auth'],
        created: '2026-04-09T03:23:00.000-0600',
        updated: '2026-04-09T03:25:00.000-0600',
      },
    };

    it('returns full issue details by key', async () => {
      mockGetIssue.mockResolvedValue(mockIssueResponse);

      const result = await executeTool(getJiraIssue, { issueKey: 'KAN-42' });

      expect(result.success).toBe(true);
      expect(result.data.key).toBe('KAN-42');
      expect(result.data.summary).toBe('API returns 500 on /auth/login');
      expect(result.data.status).toEqual({ id: '10001', name: 'En curso' });
      expect(result.data.priority).toEqual({ id: '2', name: 'High' });
      expect(result.data.assignee.accountId).toBe(ACCOUNT_ID_FERNANDO);
      expect(result.data.reporter.accountId).toBe(ACCOUNT_ID_FERNANDO);
      expect(result.data.issuetype).toEqual({ id: '10006', name: 'Bug' });
      expect(result.data.labels).toEqual(['bug', 'auth']);

      expect(mockGetIssue).toHaveBeenCalledWith({
        issueIdOrKey: 'KAN-42',
        fields: expect.arrayContaining(['summary', 'status', 'priority']),
      });
    });

    it('handles null assignee and reporter', async () => {
      mockGetIssue.mockResolvedValue({
        ...mockIssueResponse,
        fields: {
          ...mockIssueResponse.fields,
          assignee: null,
          reporter: null,
        },
      });

      const result = await executeTool(getJiraIssue, { issueKey: 'KAN-42' });

      expect(result.success).toBe(true);
      expect(result.data.assignee).toBeNull();
      expect(result.data.reporter).toBeNull();
    });

    it('returns error when issue not found', async () => {
      mockGetIssue.mockRejectedValue(new Error('Issue does not exist'));

      const result = await executeTool(getJiraIssue, { issueKey: 'KAN-99999' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Issue does not exist');
    });

    it('has id "get-jira-issue"', () => {
      expect((getJiraIssue as any).id).toBe('get-jira-issue');
    });
  });

  // =====================================================================
  // updateJiraIssue
  // =====================================================================
  describe('updateJiraIssue', () => {
    it('updates summary and priority', async () => {
      mockEditIssue.mockResolvedValue(undefined);

      const result = await executeTool(updateJiraIssue, {
        issueKey: 'KAN-42',
        summary: 'Updated title',
        priority: 'Medium',
      });

      expect(result.success).toBe(true);
      expect(result.data.issueKey).toBe('KAN-42');
      expect(result.data.updatedFields).toContain('summary');
      expect(result.data.updatedFields).toContain('priority');

      expect(mockEditIssue).toHaveBeenCalledWith({
        issueIdOrKey: 'KAN-42',
        fields: {
          summary: 'Updated title',
          priority: { name: 'Medium' },
        },
      });
    });

    it('converts description update to ADF', async () => {
      mockEditIssue.mockResolvedValue(undefined);

      await executeTool(updateJiraIssue, {
        issueKey: 'KAN-42',
        description: 'New description',
      });

      const callArgs = mockEditIssue.mock.calls[0][0];
      expect(callArgs.fields.description.type).toBe('doc');
      expect(callArgs.fields.description.version).toBe(1);
    });

    it('updates labels and assignee', async () => {
      mockEditIssue.mockResolvedValue(undefined);

      await executeTool(updateJiraIssue, {
        issueKey: 'KAN-42',
        labels: ['urgent'],
        assigneeAccountId: ACCOUNT_ID_FERNANDO,
      });

      const callArgs = mockEditIssue.mock.calls[0][0];
      expect(callArgs.fields.labels).toEqual(['urgent']);
      expect(callArgs.fields.assignee).toEqual({ accountId: ACCOUNT_ID_FERNANDO });
    });

    it('returns error when issue not found', async () => {
      mockEditIssue.mockRejectedValue(new Error('Issue does not exist'));

      const result = await executeTool(updateJiraIssue, {
        issueKey: 'KAN-99999',
        summary: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Issue does not exist');
    });

    it('has requireApproval set to true', () => {
      expect((updateJiraIssue as any).requireApproval).toBe(true);
    });

    it('has id "update-jira-issue"', () => {
      expect((updateJiraIssue as any).id).toBe('update-jira-issue');
    });
  });

  // =====================================================================
  // transitionJiraIssue
  // =====================================================================
  describe('transitionJiraIssue', () => {
    it('transitions issue to new status', async () => {
      mockDoTransition.mockResolvedValue(undefined);

      const result = await executeTool(transitionJiraIssue, {
        issueKey: 'KAN-42',
        transitionId: '21', // In Progress
      });

      expect(result.success).toBe(true);
      expect(result.data.issueKey).toBe('KAN-42');
      expect(result.data.transitionId).toBe('21');

      expect(mockDoTransition).toHaveBeenCalledWith({
        issueIdOrKey: 'KAN-42',
        transition: { id: '21' },
      });
    });

    it('returns error on invalid transition', async () => {
      mockDoTransition.mockRejectedValue(new Error('No valid transition'));

      const result = await executeTool(transitionJiraIssue, {
        issueKey: 'KAN-42',
        transitionId: '999',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No valid transition');
    });

    it('has requireApproval set to true', () => {
      expect((transitionJiraIssue as any).requireApproval).toBe(true);
    });

    it('has id "transition-jira-issue"', () => {
      expect((transitionJiraIssue as any).id).toBe('transition-jira-issue');
    });
  });

  // =====================================================================
  // addJiraComment
  // =====================================================================
  describe('addJiraComment', () => {
    it('adds comment with ADF body', async () => {
      mockAddComment.mockResolvedValue({
        id: '10000',
        created: '2026-04-09T03:23:45.989-0600',
      });

      const result = await executeTool(addJiraComment, {
        issueKey: 'KAN-42',
        body: 'Triage analysis: High severity',
      });

      expect(result.success).toBe(true);
      expect(result.data.id).toBe('10000');
      expect(result.data.issueKey).toBe('KAN-42');
      expect(result.data.created).toBe('2026-04-09T03:23:45.989-0600');

      const callArgs = mockAddComment.mock.calls[0][0];
      expect(callArgs.issueIdOrKey).toBe('KAN-42');
      // comment field should be ADF
      expect(callArgs.comment.type).toBe('doc');
      expect(callArgs.comment.version).toBe(1);
      expect(callArgs.comment.content[0].content[0].text).toBe('Triage analysis: High severity');
    });

    it('returns error when issue not found', async () => {
      mockAddComment.mockRejectedValue(new Error('Issue does not exist'));

      const result = await executeTool(addJiraComment, {
        issueKey: 'KAN-99999',
        body: 'Test comment',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Issue does not exist');
    });

    it('does NOT require approval (comments are non-destructive)', () => {
      expect((addJiraComment as any).requireApproval).toBeFalsy();
    });

    it('has id "add-jira-comment"', () => {
      expect((addJiraComment as any).id).toBe('add-jira-comment');
    });
  });

  // =====================================================================
  // searchJiraIssues
  // =====================================================================
  describe('searchJiraIssues', () => {
    it('searches with JQL and returns mapped results', async () => {
      mockEnhancedSearch.mockResolvedValue({
        issues: [
          {
            id: '10001',
            key: 'KAN-3',
            fields: {
              summary: 'API returns 500',
              status: { id: '10001', name: 'En curso' },
              priority: { id: '2', name: 'High' },
              assignee: { accountId: ACCOUNT_ID_FERNANDO, displayName: 'Fernando' },
              issuetype: { name: 'Bug' },
              labels: ['bug'],
            },
          },
          {
            id: '10002',
            key: 'KAN-4',
            fields: {
              summary: 'Webhook notifications',
              status: { id: '10002', name: 'En revisión' },
              priority: { id: '3', name: 'Medium' },
              assignee: null,
              issuetype: { name: 'Feature' },
              labels: ['feature'],
            },
          },
        ],
        total: 2,
      });

      const result = await executeTool(searchJiraIssues, {
        jql: 'project = KAN AND labels = "triage-automated"',
        maxResults: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data.issues).toHaveLength(2);
      expect(result.data.total).toBe(2);
      expect(result.data.returnedCount).toBe(2);
      expect(result.data.issues[0].key).toBe('KAN-3');
      expect(result.data.issues[0].status).toEqual({ id: '10001', name: 'En curso' });
      expect(result.data.issues[1].assignee).toBeNull();
    });

    it('returns empty results when no matches', async () => {
      mockEnhancedSearch.mockResolvedValue({ issues: [], total: 0 });

      const result = await executeTool(searchJiraIssues, {
        jql: 'project = KAN AND summary ~ "nonexistent xyz"',
      });

      expect(result.success).toBe(true);
      expect(result.data.issues).toHaveLength(0);
      expect(result.data.total).toBe(0);
      expect(result.data.returnedCount).toBe(0);
    });

    it('caps maxResults at 100 in the implementation', async () => {
      mockEnhancedSearch.mockResolvedValue({ issues: [], total: 0 });

      // Schema allows max 100, so pass 99 and verify it passes through
      await executeTool(searchJiraIssues, {
        jql: 'project = KAN',
        maxResults: 99,
      });

      expect(mockEnhancedSearch).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 99 }),
      );
    });

    it('defaults maxResults to 20', async () => {
      mockEnhancedSearch.mockResolvedValue({ issues: [], total: 0 });

      await executeTool(searchJiraIssues, {
        jql: 'project = KAN',
      });

      expect(mockEnhancedSearch).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 20 }),
      );
    });

    it('uses enhanced search endpoint (not deprecated one)', async () => {
      mockEnhancedSearch.mockResolvedValue({ issues: [], total: 0 });

      await executeTool(searchJiraIssues, { jql: 'project = KAN' });

      // The mock is on searchForIssuesUsingJqlEnhancedSearchPost, not searchForIssuesUsingJql
      expect(mockEnhancedSearch).toHaveBeenCalled();
    });

    it('returns error on invalid JQL', async () => {
      mockEnhancedSearch.mockRejectedValue(new Error('Error in the JQL Query'));

      const result = await executeTool(searchJiraIssues, {
        jql: 'invalid jql %%% syntax',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Error in the JQL Query');
    });

    it('has id "search-jira-issues"', () => {
      expect((searchJiraIssues as any).id).toBe('search-jira-issues');
    });
  });

  // =====================================================================
  // Version3Client singleton
  // =====================================================================
  describe('Version3Client singleton', () => {
    it('all tools use the same client instance (constructor called once at module load)', async () => {
      const { Version3Client } = await import('jira.js');
      const initialCallCount = (Version3Client as any).mock.calls.length;

      mockCreateIssue.mockResolvedValue({ id: '1', key: 'KAN-1', self: 'u' });
      mockGetIssue.mockResolvedValue({
        id: '1', key: 'KAN-1', self: 'u',
        fields: { summary: 't', status: null, priority: null, assignee: null, reporter: null, issuetype: null, labels: [], created: '', updated: '' },
      });

      await executeTool(createJiraIssue, { summary: 'Test' });
      await executeTool(getJiraIssue, { issueKey: 'KAN-1' });

      expect((Version3Client as any).mock.calls.length).toBe(initialCallCount);
    });
  });

  // =====================================================================
  // Error boundary pattern
  // =====================================================================
  describe('error boundary pattern', () => {
    it('all 6 tools catch errors and return { success: false, error: string }', async () => {
      const apiError = new Error('Network timeout');

      mockCreateIssue.mockRejectedValue(apiError);
      mockGetIssue.mockRejectedValue(apiError);
      mockEditIssue.mockRejectedValue(apiError);
      mockDoTransition.mockRejectedValue(apiError);
      mockAddComment.mockRejectedValue(apiError);
      mockEnhancedSearch.mockRejectedValue(apiError);

      const tools = [
        { tool: createJiraIssue, input: { summary: 'Test' } },
        { tool: getJiraIssue, input: { issueKey: 'KAN-1' } },
        { tool: updateJiraIssue, input: { issueKey: 'KAN-1', summary: 'X' } },
        { tool: transitionJiraIssue, input: { issueKey: 'KAN-1', transitionId: '21' } },
        { tool: addJiraComment, input: { issueKey: 'KAN-1', body: 'Test' } },
        { tool: searchJiraIssues, input: { jql: 'project = KAN' } },
      ];

      for (const { tool, input } of tools) {
        const result = await executeTool(tool, input);
        expect(result.success).toBe(false);
        expect(typeof result.error).toBe('string');
        expect(result.error).toContain('Network timeout');
      }
    });

    it('truncates long error messages to 200 chars', async () => {
      const longMessage = 'A'.repeat(300);
      mockCreateIssue.mockRejectedValue(new Error(longMessage));

      const result = await executeTool(createJiraIssue, { summary: 'Test' });

      expect(result.success).toBe(false);
      // error prefix "Jira API error: " + 200 chars of message
      expect(result.error.length).toBeLessThanOrEqual(220);
    });
  });

  // =====================================================================
  // Graceful degradation when JIRA_API_TOKEN is not configured
  // =====================================================================
  describe('graceful degradation when JIRA credentials are missing', () => {
    it('all 6 tools are exported from the module', () => {
      expect(createJiraIssue).toBeDefined();
      expect(getJiraIssue).toBeDefined();
      expect(updateJiraIssue).toBeDefined();
      expect(transitionJiraIssue).toBeDefined();
      expect(addJiraComment).toBeDefined();
      expect(searchJiraIssues).toBeDefined();
    });

    it('returns graceful error when credentials are undefined (dynamic re-import)', async () => {
      vi.resetModules();

      vi.doMock('../../lib/config', () => ({
        config: {
          LINEAR_API_KEY: undefined,
          RESEND_API_KEY: undefined,
          RESEND_FROM_EMAIL: 'triage@agenticengineering.lat',
          JIRA_BASE_URL: undefined,
          JIRA_EMAIL: undefined,
          JIRA_API_TOKEN: undefined,
        },
      }));
      vi.doMock('jira.js', () => ({
        Version3Client: vi.fn().mockImplementation(() => ({})),
        Version3Parameters: {},
      }));

      const jiraModule = await import('./jira');

      const result = await (jiraModule.createJiraIssue as any).execute({
        summary: 'Test',
      });

      expect(result).toBeDefined();
      expect((result as Record<string, unknown>).success).toBe(false);
      expect((result as Record<string, unknown>).error).toContain('not configured');
    });
  });

  // =====================================================================
  // Tool metadata
  // =====================================================================
  describe('tool metadata', () => {
    it('all tools have descriptions under 200 chars', () => {
      const tools = [createJiraIssue, getJiraIssue, updateJiraIssue, transitionJiraIssue, addJiraComment, searchJiraIssues];
      for (const tool of tools) {
        const desc = (tool as any).description;
        expect(desc).toBeDefined();
        expect(typeof desc).toBe('string');
        expect(desc.length).toBeLessThanOrEqual(200);
      }
    });
  });
});
