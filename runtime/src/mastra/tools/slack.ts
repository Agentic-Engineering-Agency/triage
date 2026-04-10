import { createTool } from '@mastra/core/tools';
import { WebClient } from '@slack/web-api';
import { config } from '../../lib/config';
import {
  slackTicketNotificationSchema,
  slackResolutionNotificationSchema,
  slackMessageSchema,
} from '../../lib/schemas/slack';

// ============================================================
// Slack integration tools (INTEG-03)
//
// Pattern mirrors resend.ts:
//   - Module-level singleton, guarded by API key presence
//   - Graceful degradation: if no token, log and return {success: true}
//   - Each tool: createTool({ id, description, inputSchema, execute })
//   - Exports both canonical names AND aliases for agent registration
// ============================================================

// Module-level singleton — only instantiate if bot token is configured
const slackClient = config.SLACK_BOT_TOKEN
  ? new WebClient(config.SLACK_BOT_TOKEN)
  : null;

/** Resolve channel: explicit param > env default */
function resolveChannel(channel?: string): string | undefined {
  return channel || config.SLACK_CHANNEL_ID || undefined;
}

// Severity → emoji mapping for visual triage distinction
const SEVERITY_EMOJI: Record<string, string> = {
  Critical: '🔴',
  High: '🟠',
  Medium: '🟡',
  Low: '🟢',
};

// Verdict → emoji mapping for resolution notifications
const VERDICT_EMOJI: Record<string, string> = {
  resolved: '✅',
  partially_resolved: '⚠️',
  unresolved: '❌',
};

// ---------- Tool: sendSlackTicketNotification ----------
export const sendSlackTicketNotification = createTool({
  id: 'send-slack-ticket-notification',
  description:
    'Post a triage ticket notification to a Slack channel with severity, summary, and Linear link.',
  inputSchema: slackTicketNotificationSchema,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input?.context ?? input) as Record<string, unknown>;

    const channel = resolveChannel(ctx.channel as string | undefined);

    if (!slackClient) {
      console.log(
        `[Slack] Skipping ticket notification for "${ctx.ticketTitle}" (SLACK_BOT_TOKEN not configured)`,
      );
      return { success: true };
    }

    if (!channel) {
      console.warn('[Slack] No channel specified and SLACK_CHANNEL_ID not set — skipping');
      return { success: true };
    }

    try {
      const emoji = SEVERITY_EMOJI[ctx.severity as string] || '⚪';
      const priorityLabel = `P${ctx.priority}`;

      const result = await slackClient.chat.postMessage({
        channel,
        text: `${emoji} [${ctx.severity}] New Triage Ticket: ${ctx.ticketTitle}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${emoji} New Triage Ticket`,
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Title:*\n${ctx.ticketTitle}`,
              },
              {
                type: 'mrkdwn',
                text: `*Severity:*\n${emoji} ${ctx.severity} (${priorityLabel})`,
              },
              {
                type: 'mrkdwn',
                text: `*Assigned to:*\n${ctx.assigneeName}`,
              },
              {
                type: 'mrkdwn',
                text: `*Issue:*\n<${ctx.linearUrl}|View in Linear>`,
              },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Summary:*\n${(ctx.summary as string).slice(0, 2900)}`,
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Sent by Triage • ${ctx.linearIssueId}`,
              },
            ],
          },
        ],
      });

      return {
        success: true,
        messageTs: result.ts,
        channel: result.channel,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message.slice(0, 200) : 'Unknown error';
      console.error('[Slack] API error:', msg);
      return { success: false, error: `Slack error: ${msg}` };
    }
  },
});

// ---------- Tool: sendSlackResolutionNotification ----------
export const sendSlackResolutionNotification = createTool({
  id: 'send-slack-resolution-notification',
  description:
    'Post a resolution notification to a Slack channel with verdict, summary, and Linear/PR links.',
  inputSchema: slackResolutionNotificationSchema,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input?.context ?? input) as Record<string, unknown>;

    const channel = resolveChannel(ctx.channel as string | undefined);

    if (!slackClient) {
      console.log(
        `[Slack] Skipping resolution notification for "${ctx.originalTitle}" (SLACK_BOT_TOKEN not configured)`,
      );
      return { success: true };
    }

    if (!channel) {
      console.warn('[Slack] No channel specified and SLACK_CHANNEL_ID not set — skipping');
      return { success: true };
    }

    try {
      const verdict = (ctx.verdict as string) || 'resolved';
      const verdictEmoji = VERDICT_EMOJI[verdict] || '❓';
      const verdictLabel =
        verdict === 'resolved'
          ? 'Resolved'
          : verdict === 'partially_resolved'
            ? 'Partially Resolved'
            : 'Unresolved';

      const prSection = ctx.prLink
        ? `\n<${ctx.prLink}|View Pull Request>`
        : '';

      const result = await slackClient.chat.postMessage({
        channel,
        text: `${verdictEmoji} [${verdictLabel}] ${ctx.originalTitle}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${verdictEmoji} Issue ${verdictLabel}`,
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Issue:*\n${ctx.originalTitle}`,
              },
              {
                type: 'mrkdwn',
                text: `*Status:*\n${verdictEmoji} ${verdictLabel}`,
              },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Resolution:*\n${(ctx.resolutionSummary as string).slice(0, 2900)}${prSection}`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `<${ctx.linearUrl}|View in Linear>`,
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Sent by Triage • ${ctx.linearIssueId}`,
              },
            ],
          },
        ],
      });

      return {
        success: true,
        messageTs: result.ts,
        channel: result.channel,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message.slice(0, 200) : 'Unknown error';
      console.error('[Slack] API error:', msg);
      return { success: false, error: `Slack error: ${msg}` };
    }
  },
});

// ---------- Tool: sendSlackMessage ----------
export const sendSlackMessage = createTool({
  id: 'send-slack-message',
  description:
    'Send a generic text message to a Slack channel. Supports mrkdwn formatting and threading.',
  inputSchema: slackMessageSchema,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input?.context ?? input) as Record<string, unknown>;

    const channel = resolveChannel(ctx.channel as string | undefined);

    if (!slackClient) {
      console.log(`[Slack] Skipping message send (SLACK_BOT_TOKEN not configured)`);
      return { success: true };
    }

    if (!channel) {
      console.warn('[Slack] No channel specified and SLACK_CHANNEL_ID not set — skipping');
      return { success: true };
    }

    try {
      const result = await slackClient.chat.postMessage({
        channel,
        text: ctx.text as string,
        ...(ctx.threadTs ? { thread_ts: ctx.threadTs as string } : {}),
      });

      return {
        success: true,
        messageTs: result.ts,
        channel: result.channel,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message.slice(0, 200) : 'Unknown error';
      console.error('[Slack] API error:', msg);
      return { success: false, error: `Slack error: ${msg}` };
    }
  },
});

// ============================================================
// Aliases for agent registrations
// ============================================================
export const sendSlackTicketNotificationTool = sendSlackTicketNotification;
export const sendSlackResolutionNotificationTool = sendSlackResolutionNotification;
export const sendSlackMessageTool = sendSlackMessage;
