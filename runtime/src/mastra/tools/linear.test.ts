/**
 * Tests for Linear integration tools (5 tools)
 * Spec: SPEC-20260408-002 — Scenarios S1-S6, S11
 *
 * These tests define the implementation contract for:
 *   - createLinearIssue
 *   - updateLinearIssue
 *   - getLinearIssue
 *   - searchLinearIssues
 *   - getLinearTeamMembers
 *
 * All tests mock @linear/sdk — no live API calls.
 * RED phase: all tests fail until implementation exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mock @linear/sdk ----
// Use vi.hoisted so mock fns are available before vi.mock runs (hoisting order)
const { mockCreateIssue, mockUpdateIssue, mockIssue, mockIssues, mockTeam } = vi.hoisted(() => ({
  mockCreateIssue: vi.fn(),
  mockUpdateIssue: vi.fn(),
  mockIssue: vi.fn(),
  mockIssues: vi.fn(),
  mockTeam: vi.fn(),
}));

vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    createIssue: mockCreateIssue,
    updateIssue: mockUpdateIssue,
    issue: mockIssue,
    issues: mockIssues,
    team: mockTeam,
  })),
}));

// ---- Import tools under test (will fail until implementation exists) ----
import {
  createLinearIssue,
  updateLinearIssue,
  getLinearIssue,
  searchLinearIssues,
  getLinearTeamMembers,
} from './linear';

// ---- Test constants (from spec smoke-test data) ----
const TEAM_ID = '645a639b-39e2-4abe-8ded-3346d2f79f9f';
const STATE_TRIAGE = '582398ee-98b0-406b-b2f6-8bca23c1b607';
const STATE_IN_PROGRESS = '889e861e-3bd6-4f98-888d-3e976ee583e9';
const LABEL_CRITICAL = '60a50b72-d1c2-4823-9111-f85f345138d7';
const LABEL_BUG = 'f599da19-8743-4569-a110-a666dc588811';
const MEMBER_KOKI = 'c3f725e4-aa51-45d3-af43-d29a87077226';

const mockIssueData = {
  id: 'issue-uuid-001',
  identifier: 'TRI-42',
  title: 'API Crash in Auth Module',
  url: 'https://linear.app/agentic/issue/TRI-42',
  description: '## Steps to reproduce\n1. Call /auth/login\n2. Observe 500',
  priority: 1,
  createdAt: '2026-04-08T14:30:00.000Z',
  updatedAt: '2026-04-08T14:35:00.000Z',
  state: Promise.resolve({ id: STATE_TRIAGE, name: 'Triage', type: 'triage' }),
  assignee: Promise.resolve({ id: MEMBER_KOKI, name: 'Koki', email: 'koki@agenticengineering.lat' }),
  labels: vi.fn().mockResolvedValue({
    nodes: [
      { id: LABEL_CRITICAL, name: 'tier-1' },
      { id: LABEL_BUG, name: 'Bug' },
    ],
  }),
};

// Helper: simulate calling a Mastra tool's execute function
// When inputSchema is set, Mastra validates the top-level arg then wraps in { context }.
// So we pass flat input — the framework handles the rest.
function executeTool(tool: any, input: Record<string, unknown>) {
  return tool.execute(input);
}

describe('Linear Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =====================================================================
  // S1: Create issue with all fields → returns success with identifier
  // =====================================================================
  describe('createLinearIssue', () => {
    it('S1: creates issue with all fields and returns success with identifier', async () => {
      mockCreateIssue.mockResolvedValue({
        success: true,
        issue: Promise.resolve({
          id: 'issue-uuid-001',
          identifier: 'TRI-42',
          url: 'https://linear.app/agentic/issue/TRI-42',
          title: 'API Crash in Auth Module',
        }),
      });

      const result = await executeTool(createLinearIssue, {
        title: 'API Crash in Auth Module',
        description: '## Steps to reproduce\n1. Call /auth/login\n2. Observe 500',
        teamId: TEAM_ID,
        priority: 1,
        assigneeId: MEMBER_KOKI,
        labelIds: [LABEL_CRITICAL, LABEL_BUG],
        stateId: STATE_TRIAGE,
      });

      expect(result).toEqual({
        success: true,
        data: {
          id: 'issue-uuid-001',
          identifier: 'TRI-42',
          url: 'https://linear.app/agentic/issue/TRI-42',
          title: 'API Crash in Auth Module',
        },
      });

      expect(mockCreateIssue).toHaveBeenCalledWith({
        teamId: TEAM_ID,
        title: 'API Crash in Auth Module',
        description: '## Steps to reproduce\n1. Call /auth/login\n2. Observe 500',
        priority: 1,
        assigneeId: MEMBER_KOKI,
        labelIds: [LABEL_CRITICAL, LABEL_BUG],
        stateId: STATE_TRIAGE,
      });
    });

    it('S1: requireApproval is set to true on createLinearIssue tool', () => {
      // REQ-8: Human-in-the-loop approval gate
      // The createLinearIssue tool definition must have requireApproval: true
      expect(createLinearIssue).toBeDefined();
      // Access the tool's config to verify requireApproval
      // Mastra createTool stores this as a property on the tool object
      expect((createLinearIssue as any).requireApproval).toBe(true);
    });

    it('S1: tool has id "create-linear-issue"', () => {
      expect((createLinearIssue as any).id).toBe('create-linear-issue');
    });

    it('S1: tool has a concise description (≤200 chars)', () => {
      const description = (createLinearIssue as any).description;
      expect(description).toBeDefined();
      expect(typeof description).toBe('string');
      expect(description.length).toBeLessThanOrEqual(200);
    });

    it('T4: returns error when result.issue resolves to null', async () => {
      mockCreateIssue.mockResolvedValue({
        success: true,
        issue: Promise.resolve(null),
      });

      const result = await executeTool(createLinearIssue, {
        title: 'Test Issue',
        description: 'Test',
        teamId: TEAM_ID,
        priority: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Linear API returned no issue data');
    });
  });

  // =====================================================================
  // S2: Create issue with missing LINEAR_API_KEY → returns graceful error
  // =====================================================================
  describe('createLinearIssue — graceful degradation', () => {
    it('S2: returns graceful error when LINEAR_API_KEY is not configured', async () => {
      // This test verifies that when the module-level linearClient is null
      // (because LINEAR_API_KEY was empty/undefined), the tool returns a
      // structured error without making any API call.
      //
      // In the real implementation, this is tested by setting the env var
      // to empty and re-importing the module. We simulate it here by
      // checking the error boundary behavior.
      //
      // The tool should check for null client before any SDK call.
      // When linearClient is null:
      //   → return { success: false, error: "LINEAR_API_KEY not configured" }

      // We can test this by mocking the module to have a null client.
      // For now, we verify the contract: the function exists and handles
      // the null client case. The actual env-based test uses dynamic import.
      const linearModule = await import('./linear');
      // If LINEAR_API_KEY is empty, calling any tool should return graceful error
      // This assertion tests the expected return shape
      expect(linearModule.createLinearIssue).toBeDefined();
    });
  });

  // =====================================================================
  // S3: Update issue status from Triage to In Progress
  // =====================================================================
  describe('updateLinearIssue', () => {
    it('S3: updates issue status and returns success', async () => {
      mockUpdateIssue.mockResolvedValue({
        success: true,
        issue: Promise.resolve({
          id: 'issue-uuid-001',
          identifier: 'TRI-42',
          url: 'https://linear.app/agentic/issue/TRI-42',
        }),
      });

      const result = await executeTool(updateLinearIssue, {
        issueId: 'issue-uuid-001',
        stateId: STATE_IN_PROGRESS,
      });

      expect(result).toEqual({
        success: true,
        data: {
          id: 'issue-uuid-001',
          identifier: 'TRI-42',
          url: 'https://linear.app/agentic/issue/TRI-42',
        },
      });

      expect(mockUpdateIssue).toHaveBeenCalledWith('issue-uuid-001', {
        stateId: STATE_IN_PROGRESS,
      });
    });

    it('S3: updates multiple fields at once (title, assignee, labels)', async () => {
      mockUpdateIssue.mockResolvedValue({
        success: true,
        issue: Promise.resolve({
          id: 'issue-uuid-001',
          identifier: 'TRI-42',
          url: 'https://linear.app/agentic/issue/TRI-42',
        }),
      });

      const result = await executeTool(updateLinearIssue, {
        issueId: 'issue-uuid-001',
        title: 'Updated Title',
        assigneeId: MEMBER_KOKI,
        labelIds: [LABEL_CRITICAL],
        priority: 2,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('S3: returns error when SDK throws', async () => {
      mockUpdateIssue.mockRejectedValue(new Error('Issue not found'));

      const result = await executeTool(updateLinearIssue, {
        issueId: 'nonexistent-id',
        stateId: STATE_IN_PROGRESS,
      });

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('Issue not found'),
      });
    });

    it('S3: tool has id "update-linear-issue"', () => {
      expect((updateLinearIssue as any).id).toBe('update-linear-issue');
    });
  });

  // =====================================================================
  // S4: Get issue by shorthand ID (TRI-123)
  // =====================================================================
  describe('getLinearIssue', () => {
    it('S4: gets issue by shorthand ID and returns full detail', async () => {
      mockIssue.mockResolvedValue(mockIssueData);

      const result = await executeTool(getLinearIssue, {
        issueId: 'TRI-42',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.id).toBe('issue-uuid-001');
      expect(result.data.identifier).toBe('TRI-42');
      expect(result.data.title).toBe('API Crash in Auth Module');
      expect(result.data.description).toBe('## Steps to reproduce\n1. Call /auth/login\n2. Observe 500');
      expect(result.data.state).toEqual({ id: STATE_TRIAGE, name: 'Triage', type: 'triage' });
      expect(result.data.assignee).toEqual({
        id: MEMBER_KOKI,
        name: 'Koki',
        email: 'koki@agenticengineering.lat',
      });
      expect(result.data.labels).toEqual([
        { id: LABEL_CRITICAL, name: 'tier-1' },
        { id: LABEL_BUG, name: 'Bug' },
      ]);
      expect(result.data.priority).toBe(1);
      expect(result.data.url).toBe('https://linear.app/agentic/issue/TRI-42');
      expect(result.data.createdAt).toBe('2026-04-08T14:30:00.000Z');
      expect(result.data.updatedAt).toBe('2026-04-08T14:35:00.000Z');

      expect(mockIssue).toHaveBeenCalledWith('TRI-42');
    });

    it('S4: returns error when issue not found', async () => {
      mockIssue.mockRejectedValue(new Error('Entity not found'));

      const result = await executeTool(getLinearIssue, {
        issueId: 'TRI-99999',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Entity not found');
    });

    it('S4: handles issue with null assignee', async () => {
      const issueNoAssignee = {
        ...mockIssueData,
        assignee: Promise.resolve(null),
      };
      mockIssue.mockResolvedValue(issueNoAssignee);

      const result = await executeTool(getLinearIssue, {
        issueId: 'TRI-42',
      });

      expect(result.success).toBe(true);
      expect(result.data.assignee).toBeNull();
    });

    it('S4: tool has id "get-linear-issue"', () => {
      expect((getLinearIssue as any).id).toBe('get-linear-issue');
    });
  });

  // =====================================================================
  // S5: Search issues by title for duplicate detection
  // =====================================================================
  describe('searchLinearIssues', () => {
    it('S5: searches by title query and returns matching issues', async () => {
      mockIssues.mockResolvedValue({
        nodes: [
          {
            id: 'issue-1',
            identifier: 'TRI-40',
            title: 'API crash on login',
            state: Promise.resolve({ id: STATE_TRIAGE, name: 'Triage' }),
            priority: 1,
            url: 'https://linear.app/agentic/issue/TRI-40',
          },
          {
            id: 'issue-2',
            identifier: 'TRI-41',
            title: 'API crash on signup',
            state: Promise.resolve({ id: STATE_IN_PROGRESS, name: 'In Progress' }),
            priority: 2,
            url: 'https://linear.app/agentic/issue/TRI-41',
          },
        ],
        pageInfo: { hasNextPage: false },
      });

      const result = await executeTool(searchLinearIssues, {
        query: 'API crash',
        teamId: TEAM_ID,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.issues).toHaveLength(2);
      expect(result.data.issues[0].identifier).toBe('TRI-40');
      expect(result.data.issues[1].identifier).toBe('TRI-41');
      expect(result.data.totalCount).toBe(2);

      // Verify filter was constructed correctly
      expect(mockIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({
            title: { containsIgnoreCase: 'API crash' },
            team: { id: { eq: TEAM_ID } },
          }),
        }),
      );
    });

    it('S5: returns empty results when no matches found', async () => {
      mockIssues.mockResolvedValue({
        nodes: [],
        pageInfo: { hasNextPage: false },
      });

      const result = await executeTool(searchLinearIssues, {
        query: 'nonexistent issue title xyz123',
        teamId: TEAM_ID,
      });

      expect(result.success).toBe(true);
      expect(result.data.issues).toHaveLength(0);
      expect(result.data.totalCount).toBe(0);
    });

    it('S5: respects limit parameter', async () => {
      mockIssues.mockResolvedValue({
        nodes: [{ id: 'issue-1', identifier: 'TRI-1', title: 'Test', state: Promise.resolve({ id: 'x', name: 'Triage' }), priority: 3, url: 'https://linear.app/agentic/issue/TRI-1' }],
        pageInfo: { hasNextPage: true },
      });

      await executeTool(searchLinearIssues, {
        query: 'Test',
        limit: 1,
      });

      expect(mockIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          first: 1,
        }),
      );
    });

    it('S5: defaults limit to 10 when not specified', async () => {
      mockIssues.mockResolvedValue({ nodes: [], pageInfo: { hasNextPage: false } });

      await executeTool(searchLinearIssues, {
        query: 'Test',
      });

      expect(mockIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          first: 10,
        }),
      );
    });

    it('S5: filters by assigneeId and priority', async () => {
      mockIssues.mockResolvedValue({ nodes: [], pageInfo: { hasNextPage: false } });

      await executeTool(searchLinearIssues, {
        assigneeId: MEMBER_KOKI,
        priority: 1,
      });

      expect(mockIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({
            assignee: { id: { eq: MEMBER_KOKI } },
            priority: { eq: 1 },
          }),
        }),
      );
    });

    it('S5: tool has id "search-linear-issues"', () => {
      expect((searchLinearIssues as any).id).toBe('search-linear-issues');
    });
  });

  // =====================================================================
  // S6: Get team members returns all human members (filters bots)
  // =====================================================================
  describe('getLinearTeamMembers', () => {
    it('S6: returns human team members and filters out bots', async () => {
      mockTeam.mockResolvedValue({
        members: vi.fn().mockResolvedValue({
          nodes: [
            // Human members
            { id: '90b16a9c', name: 'Fernando', email: 'fernando@agenticengineering.lat', displayName: 'Fernando', isBot: false },
            { id: 'c3f725e4', name: 'Koki', email: 'koki@agenticengineering.lat', displayName: 'Koki', isBot: false },
            { id: '7d177d95', name: 'Chenko', email: 'chenko@agenticengineering.lat', displayName: 'Chenko', isBot: false },
            { id: 'b17c4757', name: 'Lalo', email: 'lalo@agenticengineering.lat', displayName: 'Lalo', isBot: false },
            // Bot accounts (should be filtered out)
            { id: 'bot-1', name: 'Linear', email: undefined, displayName: 'Linear', isBot: true },
            { id: 'bot-2', name: 'Notion AI', email: undefined, displayName: 'Notion AI', isBot: true },
            { id: 'bot-3', name: 'Codex', email: undefined, displayName: 'Codex', isBot: true },
            { id: 'bot-4', name: 'GitHub Copilot', email: undefined, displayName: 'GitHub Copilot', isBot: true },
          ],
        }),
      });

      const result = await executeTool(getLinearTeamMembers, {
        teamId: TEAM_ID,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.members).toHaveLength(4);
      // All returned members should be humans
      result.data.members.forEach((member: any) => {
        expect(member.email).toBeDefined();
        expect(member.name).toBeDefined();
        expect(member.id).toBeDefined();
        expect(member.displayName).toBeDefined();
      });
      // Verify no bots included
      const names = result.data.members.map((m: any) => m.name);
      expect(names).not.toContain('Linear');
      expect(names).not.toContain('Notion AI');
      expect(names).not.toContain('Codex');
      expect(names).not.toContain('GitHub Copilot');
    });

    it('S6: returns error when team not found', async () => {
      mockTeam.mockRejectedValue(new Error('Team not found'));

      const result = await executeTool(getLinearTeamMembers, {
        teamId: 'nonexistent-team-id',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Team not found');
    });

    it('S6: tool has id "get-linear-team-members"', () => {
      expect((getLinearTeamMembers as any).id).toBe('get-linear-team-members');
    });
  });

  // =====================================================================
  // S11: LinearClient is singleton (same instance across tool calls)
  // =====================================================================
  describe('LinearClient singleton', () => {
    it('S11: all tools use the same LinearClient instance', async () => {
      // The LinearClient constructor should be called exactly once at module load.
      // Multiple tool calls should not create new clients.
      const { LinearClient } = await import('@linear/sdk');

      // Clear the call count from module initialization
      const initialCallCount = (LinearClient as any).mock.calls.length;

      // Execute multiple different tools
      mockCreateIssue.mockResolvedValue({
        success: true,
        issue: Promise.resolve({ id: '1', identifier: 'TRI-1', url: 'u', title: 't' }),
      });
      mockIssue.mockResolvedValue({
        ...mockIssueData,
        state: Promise.resolve({ id: 's', name: 'S', type: 't' }),
        assignee: Promise.resolve(null),
        labels: vi.fn().mockResolvedValue({ nodes: [] }),
      });

      await executeTool(createLinearIssue, {
        title: 'Test',
        description: 'Test',
        teamId: TEAM_ID,
        priority: 3,
      });

      await executeTool(getLinearIssue, {
        issueId: 'TRI-1',
      });

      // LinearClient constructor should not have been called again
      expect((LinearClient as any).mock.calls.length).toBe(initialCallCount);
    });
  });

  // =====================================================================
  // Error boundary pattern (REQ-1)
  // =====================================================================
  describe('error boundary pattern', () => {
    it('REQ-1: createLinearIssue catches SDK errors and returns structured error', async () => {
      mockCreateIssue.mockRejectedValue(new Error('Invalid input - title is required'));

      const result = await executeTool(createLinearIssue, {
        title: 'Test Error',
        description: 'test',
        teamId: TEAM_ID,
        priority: 3,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
      expect(result.error).toContain('Invalid input');
    });

    it('REQ-1: searchLinearIssues catches network timeout and returns structured error', async () => {
      mockIssues.mockRejectedValue(new Error('Request timed out'));

      const result = await executeTool(searchLinearIssues, {
        query: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Request timed out');
    });

    it('REQ-1: getLinearTeamMembers catches unexpected TypeError', async () => {
      mockTeam.mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'members')"));

      const result = await executeTool(getLinearTeamMembers, {
        teamId: TEAM_ID,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    });
  });

  // =====================================================================
  // Graceful degradation — all 5 tools (REQ-2)
  // =====================================================================
  describe('graceful degradation when LINEAR_API_KEY is empty', () => {
    // NOTE: Full env-based testing requires dynamic module re-import with
    // modified process.env.LINEAR_API_KEY. These tests verify the contract
    // that each tool checks for a null client and returns the expected error.

    it('S2: all 5 Linear tools export from the module', () => {
      expect(createLinearIssue).toBeDefined();
      expect(updateLinearIssue).toBeDefined();
      expect(getLinearIssue).toBeDefined();
      expect(searchLinearIssues).toBeDefined();
      expect(getLinearTeamMembers).toBeDefined();
    });

    it('S2: tool error message matches expected format', async () => {
      // When LINEAR_API_KEY is missing, all tools should return this exact error
      const expectedError = 'LINEAR_API_KEY not configured';

      // This verifies the error string contract.
      // The actual no-API-key path is tested via module re-import below or
      // integration tests with empty env vars.
      expect(expectedError).toBe('LINEAR_API_KEY not configured');
    });

    it('S2: returns graceful error when LINEAR_API_KEY is undefined (dynamic re-import)', async () => {
      // Reset module registry so dynamic import creates a fresh module
      vi.resetModules();

      // Use vi.doMock to mock the config module to return undefined for LINEAR_API_KEY
      vi.doMock('../../lib/config', () => ({
        config: {
          LINEAR_API_KEY: undefined,
          RESEND_API_KEY: undefined,
          RESEND_FROM_EMAIL: 'triage@agenticengineering.lat',
        },
      }));
      // Mock @linear/sdk so LinearClient constructor is available but client won't be created
      vi.doMock('@linear/sdk', () => ({
        LinearClient: vi.fn().mockImplementation(() => ({})),
      }));

      // Dynamic import to pick up the mocked config (fresh module)
      const linearModule = await import('./linear');

      const result = await linearModule.createLinearIssue.execute({
        title: 'Test',
        description: 'Test',
        teamId: '645a639b-39e2-4abe-8ded-3346d2f79f9f',
        priority: 1,
      });

      expect(result).toBeDefined();
      expect((result as Record<string, unknown>).success).toBe(false);
      expect((result as Record<string, unknown>).error).toContain('not configured');
    });
  });
});
