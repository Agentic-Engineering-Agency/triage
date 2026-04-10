import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must use vi.hoisted for mock fn references used inside vi.mock factories
const { mockPostMessage } = vi.hoisted(() => ({
  mockPostMessage: vi.fn(),
}));

// Mock @slack/web-api before imports
vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    chat: { postMessage: mockPostMessage },
  })),
}));

// Mock config
vi.mock('../../lib/config', () => ({
  config: {
    SLACK_BOT_TOKEN: 'xoxb-test-token',
    SLACK_CHANNEL_ID: 'C_TEST_CHANNEL',
    SLACK_SIGNING_SECRET: 'test-signing-secret',
  },
}));

import { sendSlackTicketNotification, sendSlackResolutionNotification, sendSlackMessage } from './slack';

describe('Slack tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendSlackTicketNotification', () => {
    it('posts a ticket notification with Block Kit formatting', async () => {
      mockPostMessage.mockResolvedValue({ ok: true, ts: '1234567890.123456', channel: 'C_TEST_CHANNEL' });

      const result = await sendSlackTicketNotification.execute!({
        context: {
          ticketTitle: 'Database connection timeout',
          severity: 'Critical',
          priority: 1,
          summary: 'PostgreSQL connections are timing out after 30s under load.',
          linearUrl: 'https://linear.app/team/issue/TRI-99',
          assigneeName: 'Fernando',
          linearIssueId: 'TRI-99',
        },
        ticketTitle: 'Database connection timeout',
        severity: 'Critical',
        priority: 1,
        summary: 'PostgreSQL connections are timing out after 30s under load.',
        linearUrl: 'https://linear.app/team/issue/TRI-99',
        assigneeName: 'Fernando',
        linearIssueId: 'TRI-99',
      });

      expect(mockPostMessage).toHaveBeenCalledOnce();
      const call = mockPostMessage.mock.calls[0][0];
      expect(call.channel).toBe('C_TEST_CHANNEL');
      expect(call.text).toContain('Critical');
      expect(call.text).toContain('Database connection timeout');
      expect(call.blocks).toBeDefined();
      expect(call.blocks.length).toBeGreaterThan(0);
      expect(result).toEqual({
        success: true,
        messageTs: '1234567890.123456',
        channel: 'C_TEST_CHANNEL',
      });
    });

    it('uses explicit channel over default', async () => {
      mockPostMessage.mockResolvedValue({ ok: true, ts: '123', channel: 'C_OVERRIDE' });

      await sendSlackTicketNotification.execute!({
        context: {
          channel: 'C_OVERRIDE',
          ticketTitle: 'Test',
          severity: 'Low',
          priority: 4,
          summary: 'Test summary',
          linearUrl: 'https://linear.app/team/issue/TRI-1',
          assigneeName: 'Koki',
          linearIssueId: 'TRI-1',
        },
        channel: 'C_OVERRIDE',
        ticketTitle: 'Test',
        severity: 'Low',
        priority: 4,
        summary: 'Test summary',
        linearUrl: 'https://linear.app/team/issue/TRI-1',
        assigneeName: 'Koki',
        linearIssueId: 'TRI-1',
      });

      expect(mockPostMessage.mock.calls[0][0].channel).toBe('C_OVERRIDE');
    });

    it('handles Slack API errors gracefully', async () => {
      mockPostMessage.mockRejectedValue(new Error('channel_not_found'));

      const result = await sendSlackTicketNotification.execute!({
        context: {
          ticketTitle: 'Test',
          severity: 'Medium',
          priority: 3,
          summary: 'Test',
          linearUrl: 'https://linear.app/team/issue/TRI-2',
          assigneeName: 'Lalo',
          linearIssueId: 'TRI-2',
        },
        ticketTitle: 'Test',
        severity: 'Medium',
        priority: 3,
        summary: 'Test',
        linearUrl: 'https://linear.app/team/issue/TRI-2',
        assigneeName: 'Lalo',
        linearIssueId: 'TRI-2',
      });

      expect(result).toMatchObject({ success: false });
      expect((result as { error: string }).error).toContain('channel_not_found');
    });
  });

  describe('sendSlackResolutionNotification', () => {
    it('posts a resolution notification', async () => {
      mockPostMessage.mockResolvedValue({ ok: true, ts: '999', channel: 'C_TEST_CHANNEL' });

      const result = await sendSlackResolutionNotification.execute!({
        context: {
          originalTitle: 'DB timeout issue',
          resolutionSummary: 'Increased pool size from 5 to 20.',
          verdict: 'resolved',
          linearUrl: 'https://linear.app/team/issue/TRI-99',
          linearIssueId: 'TRI-99',
        },
        originalTitle: 'DB timeout issue',
        resolutionSummary: 'Increased pool size from 5 to 20.',
        verdict: 'resolved',
        linearUrl: 'https://linear.app/team/issue/TRI-99',
        linearIssueId: 'TRI-99',
      });

      expect(mockPostMessage).toHaveBeenCalledOnce();
      const call = mockPostMessage.mock.calls[0][0];
      expect(call.text).toContain('Resolved');
      expect(result).toMatchObject({ success: true, messageTs: '999' });
    });
  });

  describe('sendSlackMessage', () => {
    it('sends a simple text message', async () => {
      mockPostMessage.mockResolvedValue({ ok: true, ts: '555', channel: 'C_TEST_CHANNEL' });

      const result = await sendSlackMessage.execute!({
        context: {
          text: 'Hello from Triage!',
        },
        text: 'Hello from Triage!',
      });

      expect(mockPostMessage).toHaveBeenCalledOnce();
      expect(mockPostMessage.mock.calls[0][0].text).toBe('Hello from Triage!');
      expect(result).toMatchObject({ success: true });
    });

    it('supports threading via threadTs', async () => {
      mockPostMessage.mockResolvedValue({ ok: true, ts: '666', channel: 'C_TEST_CHANNEL' });

      await sendSlackMessage.execute!({
        context: {
          text: 'Thread reply',
          threadTs: '555.000',
        },
        text: 'Thread reply',
        threadTs: '555.000',
      });

      expect(mockPostMessage.mock.calls[0][0].thread_ts).toBe('555.000');
    });
  });
});
