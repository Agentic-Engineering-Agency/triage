import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { severitySchema } from '../../lib/schemas';

const emailResultSchema = z.object({
  id: z.string().describe('Resend message ID'),
  success: z.boolean(),
});

export const sendTicketEmailTool = createTool({
  id: 'send-ticket-email',
  description: 'Send email notification about a new triage ticket.',
  inputSchema: z.object({
    to: z.string().email().describe('Recipient email address'),
    ticketTitle: z.string().describe('Title of the created ticket'),
    ticketUrl: z.string().url().describe('Direct URL to the Linear issue'),
    severity: severitySchema.describe('Severity level for the incident'),
    summary: z.string().describe('Brief triage summary for the email body'),
  }),
  outputSchema: emailResultSchema,
  execute: async () => {
    throw new Error('Not implemented yet');
  },
});

export const sendResolutionEmailTool = createTool({
  id: 'send-resolution-email',
  description: 'Send email notification about ticket resolution.',
  inputSchema: z.object({
    to: z.string().email().describe('Recipient email address'),
    ticketTitle: z.string().describe('Title of the resolved ticket'),
    ticketUrl: z.string().url().describe('Direct URL to the Linear issue'),
    resolution: z.string().describe('Resolution summary / notes'),
  }),
  outputSchema: emailResultSchema,
  execute: async () => {
    throw new Error('Not implemented yet');
  },
});
