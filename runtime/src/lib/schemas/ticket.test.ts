/**
 * Tests for shared Zod schemas (ticket.ts)
 * Spec: SPEC-20260408-002 — Scenario S12 + REQ-4 (shared schemas)
 *
 * These tests validate all Zod schemas defined in the spec:
 *   - ticketCreateSchema
 *   - ticketResponseSchema
 *   - ticketUpdateSchema
 *   - issueDetailSchema
 *   - issueSearchSchema
 *   - issueSearchResultSchema
 *   - teamMemberSchema
 *   - teamMembersResponseSchema
 *   - ticketNotificationSchema
 *   - resolutionNotificationSchema
 *   - emailResponseSchema
 *   - prioritySchema
 *
 * RED phase: all tests fail until the schema file exists.
 */

import { describe, it, expect } from 'vitest';

// ---- Import schemas under test (will fail until implementation exists) ----
import {
  prioritySchema,
  ticketCreateSchema,
  ticketResponseSchema,
  ticketUpdateSchema,
  issueDetailSchema,
  issueSearchSchema,
  issueSearchResultSchema,
  teamMemberSchema,
  teamMembersResponseSchema,
  ticketNotificationSchema,
  resolutionNotificationSchema,
  emailResponseSchema,
  toolSuccessSchema,
  toolErrorSchema,
} from './ticket';

// ---- Test data ----
const VALID_UUID = '645a639b-39e2-4abe-8ded-3346d2f79f9f';
const VALID_UUID_2 = '90b16a9c-3f47-49fc-8d98-abf3aa6ecb13';

describe('Zod Schemas — ticket.ts', () => {
  // =====================================================================
  // prioritySchema
  // =====================================================================
  describe('prioritySchema', () => {
    it('accepts valid priorities (0-4)', () => {
      expect(prioritySchema.parse(0)).toBe(0);
      expect(prioritySchema.parse(1)).toBe(1);
      expect(prioritySchema.parse(2)).toBe(2);
      expect(prioritySchema.parse(3)).toBe(3);
      expect(prioritySchema.parse(4)).toBe(4);
    });

    it('rejects priority below 0', () => {
      expect(() => prioritySchema.parse(-1)).toThrow();
    });

    it('rejects priority above 4', () => {
      expect(() => prioritySchema.parse(5)).toThrow();
    });

    it('rejects non-number values', () => {
      expect(() => prioritySchema.parse('high')).toThrow();
      expect(() => prioritySchema.parse(null)).toThrow();
    });
  });

  // =====================================================================
  // ticketCreateSchema
  // =====================================================================
  describe('ticketCreateSchema', () => {
    const validInput = {
      title: 'API Crash in Auth Module',
      description: '## Steps to reproduce\n1. Call /auth/login',
      teamId: VALID_UUID,
      priority: 1,
    };

    it('accepts valid input with required fields only', () => {
      const result = ticketCreateSchema.parse(validInput);
      expect(result.title).toBe('API Crash in Auth Module');
      expect(result.teamId).toBe(VALID_UUID);
      expect(result.priority).toBe(1);
    });

    it('accepts valid input with all optional fields', () => {
      const fullInput = {
        ...validInput,
        assigneeId: VALID_UUID_2,
        labelIds: [VALID_UUID, VALID_UUID_2],
        stateId: VALID_UUID,
      };
      const result = ticketCreateSchema.parse(fullInput);
      expect(result.assigneeId).toBe(VALID_UUID_2);
      expect(result.labelIds).toHaveLength(2);
      expect(result.stateId).toBe(VALID_UUID);
    });

    it('rejects empty title', () => {
      expect(() => ticketCreateSchema.parse({ ...validInput, title: '' })).toThrow();
    });

    it('rejects missing title', () => {
      const { title, ...noTitle } = validInput;
      expect(() => ticketCreateSchema.parse(noTitle)).toThrow();
    });

    it('rejects missing teamId', () => {
      const { teamId, ...noTeamId } = validInput;
      expect(() => ticketCreateSchema.parse(noTeamId)).toThrow();
    });

    it('rejects invalid teamId (not UUID)', () => {
      expect(() => ticketCreateSchema.parse({ ...validInput, teamId: 'not-a-uuid' })).toThrow();
    });

    it('rejects priority out of range', () => {
      expect(() => ticketCreateSchema.parse({ ...validInput, priority: 5 })).toThrow();
      expect(() => ticketCreateSchema.parse({ ...validInput, priority: -1 })).toThrow();
    });

    it('rejects invalid assigneeId (not UUID)', () => {
      expect(() => ticketCreateSchema.parse({ ...validInput, assigneeId: 'not-uuid' })).toThrow();
    });

    it('rejects invalid labelIds (not UUID array)', () => {
      expect(() => ticketCreateSchema.parse({ ...validInput, labelIds: ['not-uuid'] })).toThrow();
    });
  });

  // =====================================================================
  // ticketResponseSchema
  // =====================================================================
  describe('ticketResponseSchema', () => {
    it('accepts success response with data', () => {
      const result = ticketResponseSchema.parse({
        success: true,
        data: {
          id: VALID_UUID,
          identifier: 'TRI-42',
          url: 'https://linear.app/agentic/issue/TRI-42',
          title: 'API Crash',
        },
      });
      expect(result.success).toBe(true);
      expect(result.data?.identifier).toBe('TRI-42');
    });

    it('accepts error response', () => {
      const result = ticketResponseSchema.parse({
        success: false,
        error: 'LINEAR_API_KEY not configured',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('LINEAR_API_KEY not configured');
    });

    it('rejects missing success field', () => {
      expect(() => ticketResponseSchema.parse({ data: { id: '1' } })).toThrow();
    });

    it('rejects invalid url in data', () => {
      expect(() =>
        ticketResponseSchema.parse({
          success: true,
          data: {
            id: '1',
            identifier: 'TRI-1',
            url: 'not-a-url',
            title: 'T',
          },
        }),
      ).toThrow();
    });
  });

  // =====================================================================
  // ticketUpdateSchema
  // =====================================================================
  describe('ticketUpdateSchema', () => {
    it('accepts valid update with issueId and stateId', () => {
      const result = ticketUpdateSchema.parse({
        issueId: 'TRI-42',
        stateId: VALID_UUID,
      });
      expect(result.issueId).toBe('TRI-42');
      expect(result.stateId).toBe(VALID_UUID);
    });

    it('accepts update with all optional fields', () => {
      const result = ticketUpdateSchema.parse({
        issueId: VALID_UUID,
        title: 'Updated Title',
        description: 'Updated description',
        priority: 2,
        assigneeId: VALID_UUID_2,
        stateId: VALID_UUID,
        labelIds: [VALID_UUID],
      });
      expect(result.title).toBe('Updated Title');
    });

    it('rejects missing issueId', () => {
      expect(() => ticketUpdateSchema.parse({ stateId: VALID_UUID })).toThrow();
    });

    it('rejects empty issueId', () => {
      expect(() => ticketUpdateSchema.parse({ issueId: '' })).toThrow();
    });
  });

  // =====================================================================
  // issueDetailSchema
  // =====================================================================
  describe('issueDetailSchema', () => {
    it('accepts a full issue detail response', () => {
      const result = issueDetailSchema.parse({
        success: true,
        data: {
          id: VALID_UUID,
          identifier: 'TRI-42',
          title: 'API Crash',
          description: 'Some description',
          state: { id: 's1', name: 'Triage', type: 'triage' },
          assignee: { id: 'u1', name: 'Koki', email: 'koki@test.com' },
          labels: [{ id: 'l1', name: 'tier-1' }],
          priority: 1,
          url: 'https://linear.app/agentic/issue/TRI-42',
          createdAt: '2026-04-08T14:30:00.000Z',
          updatedAt: '2026-04-08T14:35:00.000Z',
        },
      });
      expect(result.success).toBe(true);
      expect(result.data?.state.name).toBe('Triage');
    });

    it('accepts null description', () => {
      const result = issueDetailSchema.parse({
        success: true,
        data: {
          id: VALID_UUID,
          identifier: 'TRI-42',
          title: 'API Crash',
          description: null,
          state: { id: 's1', name: 'Triage', type: 'triage' },
          assignee: null,
          labels: [],
          priority: 0,
          url: 'https://linear.app/agentic/issue/TRI-42',
          createdAt: '2026-04-08T14:30:00.000Z',
          updatedAt: '2026-04-08T14:35:00.000Z',
        },
      });
      expect(result.data?.description).toBeNull();
      expect(result.data?.assignee).toBeNull();
    });

    it('accepts error response', () => {
      const result = issueDetailSchema.parse({
        success: false,
        error: 'Entity not found',
      });
      expect(result.success).toBe(false);
    });
  });

  // =====================================================================
  // issueSearchSchema
  // =====================================================================
  describe('issueSearchSchema', () => {
    it('accepts search with query only', () => {
      const result = issueSearchSchema.parse({ query: 'API crash' });
      expect(result.query).toBe('API crash');
      expect(result.limit).toBe(10); // default
    });

    it('accepts search with all filters', () => {
      const result = issueSearchSchema.parse({
        query: 'API crash',
        teamId: VALID_UUID,
        status: 'In Progress',
        assigneeId: VALID_UUID_2,
        labels: ['tier-1', 'Bug'],
        priority: 1,
        limit: 25,
      });
      expect(result.teamId).toBe(VALID_UUID);
      expect(result.limit).toBe(25);
    });

    it('accepts empty search (all fields optional)', () => {
      const result = issueSearchSchema.parse({});
      expect(result.limit).toBe(10);
    });

    it('rejects limit below 1', () => {
      expect(() => issueSearchSchema.parse({ limit: 0 })).toThrow();
    });

    it('rejects limit above 50', () => {
      expect(() => issueSearchSchema.parse({ limit: 51 })).toThrow();
    });
  });

  // =====================================================================
  // issueSearchResultSchema
  // =====================================================================
  describe('issueSearchResultSchema', () => {
    it('accepts search results with issues', () => {
      const result = issueSearchResultSchema.parse({
        success: true,
        data: {
          issues: [
            {
              id: 'i1',
              identifier: 'TRI-40',
              title: 'API crash on login',
              state: { id: 's1', name: 'Triage' },
              priority: 1,
              url: 'https://linear.app/agentic/issue/TRI-40',
            },
          ],
          totalCount: 1,
        },
      });
      expect(result.data?.issues).toHaveLength(1);
      expect(result.data?.totalCount).toBe(1);
    });

    it('accepts empty search results', () => {
      const result = issueSearchResultSchema.parse({
        success: true,
        data: { issues: [], totalCount: 0 },
      });
      expect(result.data?.issues).toHaveLength(0);
    });

    it('accepts error response', () => {
      const result = issueSearchResultSchema.parse({
        success: false,
        error: 'Search failed',
      });
      expect(result.success).toBe(false);
    });
  });

  // =====================================================================
  // teamMemberSchema
  // =====================================================================
  describe('teamMemberSchema', () => {
    it('accepts valid member', () => {
      const result = teamMemberSchema.parse({
        id: VALID_UUID,
        name: 'Koki',
        email: 'koki@agenticengineering.lat',
        displayName: 'Koki',
      });
      expect(result.name).toBe('Koki');
    });

    it('rejects invalid email', () => {
      expect(() =>
        teamMemberSchema.parse({
          id: VALID_UUID,
          name: 'Koki',
          email: 'not-an-email',
          displayName: 'Koki',
        }),
      ).toThrow();
    });

    it('rejects missing name', () => {
      expect(() =>
        teamMemberSchema.parse({
          id: VALID_UUID,
          email: 'koki@test.com',
          displayName: 'Koki',
        }),
      ).toThrow();
    });
  });

  // =====================================================================
  // teamMembersResponseSchema
  // =====================================================================
  describe('teamMembersResponseSchema', () => {
    it('accepts response with members', () => {
      const result = teamMembersResponseSchema.parse({
        success: true,
        data: {
          members: [
            { id: '1', name: 'Fernando', email: 'fernando@test.com', displayName: 'Fernando' },
            { id: '2', name: 'Koki', email: 'koki@test.com', displayName: 'Koki' },
          ],
        },
      });
      expect(result.data?.members).toHaveLength(2);
    });

    it('accepts response with empty members array', () => {
      const result = teamMembersResponseSchema.parse({
        success: true,
        data: { members: [] },
      });
      expect(result.data?.members).toHaveLength(0);
    });

    it('accepts error response', () => {
      const result = teamMembersResponseSchema.parse({
        success: false,
        error: 'Team not found',
      });
      expect(result.success).toBe(false);
    });
  });

  // =====================================================================
  // ticketNotificationSchema
  // =====================================================================
  describe('ticketNotificationSchema', () => {
    const validNotification = {
      to: 'koki@agenticengineering.lat',
      ticketTitle: 'API Crash in Auth Module',
      severity: 'Critical' as const,
      priority: 1,
      summary: 'The auth module crashes on login.',
      linearUrl: 'https://linear.app/agentic/issue/TRI-42',
      assigneeName: 'Koki',
      linearIssueId: 'issue-uuid-001',
    };

    it('accepts valid notification input', () => {
      const result = ticketNotificationSchema.parse(validNotification);
      expect(result.to).toBe('koki@agenticengineering.lat');
      expect(result.severity).toBe('Critical');
    });

    it('rejects invalid email in to field', () => {
      expect(() =>
        ticketNotificationSchema.parse({ ...validNotification, to: 'not-email' }),
      ).toThrow();
    });

    it('rejects invalid severity', () => {
      expect(() =>
        ticketNotificationSchema.parse({ ...validNotification, severity: 'Extreme' }),
      ).toThrow();
    });

    it('accepts all valid severity values', () => {
      for (const severity of ['Critical', 'High', 'Medium', 'Low']) {
        const result = ticketNotificationSchema.parse({ ...validNotification, severity });
        expect(result.severity).toBe(severity);
      }
    });

    it('rejects invalid linearUrl', () => {
      expect(() =>
        ticketNotificationSchema.parse({ ...validNotification, linearUrl: 'not-a-url' }),
      ).toThrow();
    });

    it('rejects missing required fields', () => {
      expect(() => ticketNotificationSchema.parse({})).toThrow();
      expect(() => ticketNotificationSchema.parse({ to: 'test@test.com' })).toThrow();
    });
  });

  // =====================================================================
  // resolutionNotificationSchema
  // =====================================================================
  describe('resolutionNotificationSchema', () => {
    it('accepts single email string for "to"', () => {
      const result = resolutionNotificationSchema.parse({
        to: 'reporter@example.com',
        originalTitle: 'API Crash',
        resolutionSummary: 'Fixed by patching JWT validation',
        linearUrl: 'https://linear.app/agentic/issue/TRI-42',
        linearIssueId: 'issue-uuid-001',
      });
      expect(result.to).toBe('reporter@example.com');
    });

    it('accepts array of emails for "to"', () => {
      const result = resolutionNotificationSchema.parse({
        to: ['a@example.com', 'b@example.com'],
        originalTitle: 'API Crash',
        resolutionSummary: 'Fixed',
        linearUrl: 'https://linear.app/agentic/issue/TRI-42',
        linearIssueId: 'issue-uuid-001',
      });
      expect(result.to).toEqual(['a@example.com', 'b@example.com']);
    });

    it('prLink is optional', () => {
      const result = resolutionNotificationSchema.parse({
        to: 'reporter@example.com',
        originalTitle: 'Bug',
        resolutionSummary: 'Fixed',
        linearUrl: 'https://linear.app/agentic/issue/TRI-42',
        linearIssueId: 'issue-uuid-001',
      });
      expect(result.prLink).toBeUndefined();
    });

    it('accepts prLink when provided', () => {
      const result = resolutionNotificationSchema.parse({
        to: 'reporter@example.com',
        originalTitle: 'Bug',
        resolutionSummary: 'Fixed',
        prLink: 'https://github.com/org/repo/pull/123',
        linearUrl: 'https://linear.app/agentic/issue/TRI-42',
        linearIssueId: 'issue-uuid-001',
      });
      expect(result.prLink).toBe('https://github.com/org/repo/pull/123');
    });

    it('rejects invalid prLink', () => {
      expect(() =>
        resolutionNotificationSchema.parse({
          to: 'reporter@example.com',
          originalTitle: 'Bug',
          resolutionSummary: 'Fixed',
          prLink: 'not-a-url',
          linearUrl: 'https://linear.app/agentic/issue/TRI-42',
          linearIssueId: 'issue-uuid-001',
        }),
      ).toThrow();
    });

    it('rejects invalid email in array', () => {
      expect(() =>
        resolutionNotificationSchema.parse({
          to: ['valid@example.com', 'not-an-email'],
          originalTitle: 'Bug',
          resolutionSummary: 'Fixed',
          linearUrl: 'https://linear.app/agentic/issue/TRI-42',
          linearIssueId: 'id',
        }),
      ).toThrow();
    });
  });

  // =====================================================================
  // emailResponseSchema
  // =====================================================================
  describe('emailResponseSchema', () => {
    it('accepts success response with emailId', () => {
      const result = emailResponseSchema.parse({
        success: true,
        emailId: 'email-123',
      });
      expect(result.success).toBe(true);
      expect(result.emailId).toBe('email-123');
    });

    it('accepts success response without emailId (graceful skip)', () => {
      const result = emailResponseSchema.parse({
        success: true,
      });
      expect(result.success).toBe(true);
      expect(result.emailId).toBeUndefined();
    });

    it('accepts error response', () => {
      const result = emailResponseSchema.parse({
        success: false,
        error: 'Resend error: Invalid API key',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Resend error: Invalid API key');
    });

    it('rejects missing success field', () => {
      expect(() => emailResponseSchema.parse({ emailId: 'e1' })).toThrow();
    });
  });

  // =====================================================================
  // S12: Config validation rejects invalid env vars
  // =====================================================================
  describe('S12: schema validation for config-adjacent concerns', () => {
    it('ticketCreateSchema rejects completely invalid data', () => {
      expect(() => ticketCreateSchema.parse({})).toThrow();
      expect(() => ticketCreateSchema.parse(null)).toThrow();
      expect(() => ticketCreateSchema.parse('string')).toThrow();
    });

    it('ticketNotificationSchema rejects completely invalid data', () => {
      expect(() => ticketNotificationSchema.parse({})).toThrow();
      expect(() => ticketNotificationSchema.parse(null)).toThrow();
    });

    it('all schemas are exported and are Zod schemas', () => {
      const schemas = [
        prioritySchema,
        ticketCreateSchema,
        ticketResponseSchema,
        ticketUpdateSchema,
        issueDetailSchema,
        issueSearchSchema,
        issueSearchResultSchema,
        teamMemberSchema,
        teamMembersResponseSchema,
        ticketNotificationSchema,
        resolutionNotificationSchema,
        emailResponseSchema,
        toolSuccessSchema,
        toolErrorSchema,
      ];

      schemas.forEach((schema) => {
        expect(schema).toBeDefined();
        expect(typeof schema.parse).toBe('function');
        expect(typeof schema.safeParse).toBe('function');
      });
    });
  });

  // =====================================================================
  // toolSuccessSchema
  // =====================================================================
  describe('toolSuccessSchema', () => {
    it('accepts success response with data', () => {
      const result = toolSuccessSchema.parse({
        success: true,
        data: { id: 'issue-1', identifier: 'TRI-42' },
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'issue-1', identifier: 'TRI-42' });
    });

    it('accepts success response without data', () => {
      const result = toolSuccessSchema.parse({ success: true });
      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('rejects success: false', () => {
      expect(() => toolSuccessSchema.parse({ success: false })).toThrow();
    });

    it('rejects missing success field', () => {
      expect(() => toolSuccessSchema.parse({ data: {} })).toThrow();
    });

    it('rejects non-boolean success', () => {
      expect(() => toolSuccessSchema.parse({ success: 'true' })).toThrow();
    });
  });

  // =====================================================================
  // toolErrorSchema
  // =====================================================================
  describe('toolErrorSchema', () => {
    it('accepts error response with message', () => {
      const result = toolErrorSchema.parse({
        success: false,
        error: 'LINEAR_API_KEY not configured',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('LINEAR_API_KEY not configured');
    });

    it('rejects success: true', () => {
      expect(() => toolErrorSchema.parse({ success: true, error: 'oops' })).toThrow();
    });

    it('rejects missing error field', () => {
      expect(() => toolErrorSchema.parse({ success: false })).toThrow();
    });

    it('rejects non-string error', () => {
      expect(() => toolErrorSchema.parse({ success: false, error: 123 })).toThrow();
    });

    it('rejects missing success field', () => {
      expect(() => toolErrorSchema.parse({ error: 'oops' })).toThrow();
    });
  });
});
