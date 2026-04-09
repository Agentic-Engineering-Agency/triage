import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

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
// Tools
// ---------------------------------------------------------------------------

export const createLinearIssueTool = createTool({
  id: 'create-linear-issue',
  description: 'Create a new Linear issue for an SRE incident.',
  inputSchema: ticketCreateInputSchema,
  outputSchema: ticketResponseSchema,
  execute: async () => {
    throw new Error('Not implemented yet');
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
  execute: async () => {
    throw new Error('Not implemented yet');
  },
});

export const getLinearIssueTool = createTool({
  id: 'get-linear-issue',
  description: 'Get details of a Linear issue by ID or identifier.',
  inputSchema: z.object({
    issueId: z.string().describe('Linear issue UUID or human-readable identifier (e.g. SRE-42)'),
  }),
  outputSchema: ticketResponseWithDescriptionSchema,
  execute: async () => {
    throw new Error('Not implemented yet');
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
  execute: async () => {
    throw new Error('Not implemented yet');
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
  execute: async () => {
    throw new Error('Not implemented yet');
  },
});
