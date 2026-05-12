import { createTool } from '@mastra/core/tools';
import { WebClient } from '@slack/web-api';
import { config } from '../../lib/config';
import { resolveKey } from '../../lib/tenant-keys';
import {
  slackTicketNotificationSchema,
  slackResolutionNotificationSchema,
  slackMessageSchema,
} from '../../lib/schemas/slack';

// ============================================================
// Slack integration tools (INTEG-03)
//
// Multi-tenant refactor: the WebClient is no longer a module-level
// singleton. Each tool.execute resolves the token via tenant-keys
// (project_integrations row → env fallback) so tenants can bring their
// own Slack workspaces. Graceful degradation is unchanged: missing key
// → log + return { success: true } so the workflow doesn't stall.
// ============================================================

type ToolCtx = { requestContext?: { get: (key: string) => unknown } } | undefined;

// Resolve a per-tenant Slack client. Channel resolution still honours the
// explicit param > integration-meta.channelId > env SLACK_CHANNEL_ID chain.
async function resolveSlack(
  toolCtx: ToolCtx,
): Promise<{ client: WebClient | null; metaChannel?: string }> {
  const projectId = toolCtx?.requestContext?.get('projectId') as string | undefined;
  const { key, meta } = await resolveKey('slack', projectId);
  if (!key) return { client: null, metaChannel: meta.channelId };
  return { client: new WebClient(key), metaChannel: meta.channelId };
}

/** Resolve channel: explicit param > integration meta > env default */
function resolveChannel(channel?: string, metaChannel?: string): string | undefined {
  return channel || metaChannel || config.SLACK_CHANNEL_ID || undefined;
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
  execute: async (
    input: { context: Record<string, unknown> } | Record<string, unknown>,
    toolCtx?: ToolCtx,
  ) => {
    const ctx = (input?.context ?? input) as Record<string, unknown>;
    const { client: slackClient, metaChannel } = await resolveSlack(toolCtx);

    const channel = resolveChannel(ctx.channel as string | undefined, metaChannel);

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
  execute: async (
    input: { context: Record<string, unknown> } | Record<string, unknown>,
    toolCtx?: ToolCtx,
  ) => {
    const ctx = (input?.context ?? input) as Record<string, unknown>;
    const { client: slackClient, metaChannel } = await resolveSlack(toolCtx);

    const channel = resolveChannel(ctx.channel as string | undefined, metaChannel);

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
  execute: async (
    input: { context: Record<string, unknown> } | Record<string, unknown>,
    toolCtx?: ToolCtx,
  ) => {
    const ctx = (input?.context ?? input) as Record<string, unknown>;
    const { client: slackClient, metaChannel } = await resolveSlack(toolCtx);

    const channel = resolveChannel(ctx.channel as string | undefined, metaChannel);

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
