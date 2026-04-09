import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  ticketCreateSchema,
  ticketResponseSchema,
  severitySchema,
  prioritySchema,
} from '../../lib/schemas';

/**
 * Shared input for updating an existing Linear issue.
 * Reuses the canonical severity/priority vocabulary from the shared schemas.
 */
const ticketUpdateInputSchema = z.object({
  issueId: z.string().describe('Linear issue UUID or identifier'),
  title: z.string().optional(),
  description: z.string().optional(),
  severity: severitySchema.optional(),
  priority: prioritySchema.optional(),
  teamKey: z.string().optional().describe('Linear team key, e.g. "TRI"'),
  assigneeId: z.string().optional(),
  labels: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  stateId: z.string().optional().describe('Workflow state ID to transition to'),
});

/** Extended response that includes the full description body. */
const ticketResponseWithDescriptionSchema = ticketResponseSchema.extend({
  description: z.string().nullable().describe('Markdown body of the issue'),
});

export const createLinearIssueTool = createTool({
  id: 'create-linear-issue',
  description: 'Create a new Linear issue for an SRE incident.',
  inputSchema: ticketCreateSchema,
  outputSchema: ticketResponseSchema,
  execute: async () => {
    throw new Error('Not implemented yet');
  },
});

export const updateLinearIssueTool = createTool({
  id: 'update-linear-issue',
  description: 'Update an existing Linear issue.',
  inputSchema: ticketUpdateInputSchema,
  outputSchema: ticketResponseSchema,
  execute: async () => {
    throw new Error('Not implemented yet');
  },
});

export const getLinearIssueTool = createTool({
  id: 'get-linear-issue',
  description: 'Get details of a Linear issue by ID or identifier.',
  inputSchema: z.object({
    issueId: z.string().describe('Linear issue UUID or human-readable identifier (e.g. TRI-42)'),
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
