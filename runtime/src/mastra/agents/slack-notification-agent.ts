import { Agent } from '@mastra/core/agent';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { MODELS } from '../../lib/config';
import { sendSlackMessage } from '../tools/slack';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

/**
 * Slack Notification Agent
 *
 * Simple agent that formats and sends Slack notifications.
 * Uses Mercury for fast, lightweight message formatting.
 *
 * Input: ticket data (title, severity, summary, link, etc)
 * Output: Sends formatted message to Slack
 */
export const slackNotificationAgent = new Agent({
  id: 'slack-notification-agent',
  name: 'Slack Notification Agent',
  instructions: `You are a Slack notification bot. Your ONLY job is to format and send ticket notifications to Slack.

When given ticket data (title, severity, summary, Linear link, assignee, issue ID), you MUST:

1. Format it as a clear, concise Slack message
2. Use the sendSlackMessage tool to send it
3. Do NOT answer questions or do anything else

Keep messages professional and scannable. Use bold for important info.
Do NOT ask for confirmation, do NOT add commentary, just send the message.`,
  model: openrouter(MODELS.mercury, {
    extraBody: {
      models: [MODELS.mercury, MODELS.orchestratorFallback1],
      route: 'fallback',
      max_tokens: 800,
    },
  }),
  tools: {
    sendSlackMessage,
  },
});
