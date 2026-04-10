import { z } from 'zod';

// ============================================================
// Slack integration schemas (INTEG-03)
// ============================================================

/** Input for posting a triage ticket notification to Slack */
export const slackTicketNotificationSchema = z.object({
  channel: z.string().optional().describe('Slack channel ID (falls back to SLACK_CHANNEL_ID env)'),
  ticketTitle: z.string().min(1),
  severity: z.enum(['Critical', 'High', 'Medium', 'Low']),
  priority: z.number().int().min(0).max(4),
  summary: z.string().max(10000),
  linearUrl: z.string().url(),
  assigneeName: z.string(),
  linearIssueId: z.string(),
});

export type SlackTicketNotification = z.infer<typeof slackTicketNotificationSchema>;

/** Input for posting a resolution notification to Slack */
export const slackResolutionNotificationSchema = z.object({
  channel: z.string().optional().describe('Slack channel ID (falls back to SLACK_CHANNEL_ID env)'),
  originalTitle: z.string(),
  resolutionSummary: z.string().max(10000),
  verdict: z.enum(['resolved', 'partially_resolved', 'unresolved']).optional(),
  prLink: z.string().url().optional(),
  linearUrl: z.string().url(),
  linearIssueId: z.string(),
});

export type SlackResolutionNotification = z.infer<typeof slackResolutionNotificationSchema>;

/** Input for sending a generic message to Slack */
export const slackMessageSchema = z.object({
  channel: z.string().optional().describe('Slack channel ID (falls back to SLACK_CHANNEL_ID env)'),
  text: z.string().min(1).max(40000).describe('Message text (supports mrkdwn)'),
  threadTs: z.string().optional().describe('Thread timestamp to reply in a thread'),
});

export type SlackMessage = z.infer<typeof slackMessageSchema>;

/** Shared success/error response from Slack tools */
export const slackResponseSchema = z.object({
  success: z.boolean(),
  messageTs: z.string().optional().describe('Slack message timestamp (use for threading)'),
  channel: z.string().optional(),
  error: z.string().optional(),
});

export type SlackResponse = z.infer<typeof slackResponseSchema>;
