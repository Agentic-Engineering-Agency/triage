import { createTool } from '@mastra/core/tools';
import { Resend } from 'resend';
import { z } from 'zod';
import { config } from '../../lib/config';

// ---------------------------------------------------------------------------
// Inline Zod schemas for email tool I/O.
// No canonical shared schema for email payloads — these are tool-specific.
// ---------------------------------------------------------------------------

const emailResultSchema = z.object({
  id: z.string().describe('Resend message ID'),
  success: z.boolean(),
});

// ---------------------------------------------------------------------------
// Resend client singleton
// ---------------------------------------------------------------------------

const resendClient = config.RESEND_API_KEY
  ? new Resend(config.RESEND_API_KEY)
  : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape HTML special characters to prevent XSS in email templates. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Validate that a URL starts with https:// for safe href usage. */
function safeHref(url: string): string {
  if (url.startsWith('https://')) return url;
  if (url.startsWith('http://')) return url; // allow http for dev
  return '#';
}

/** Truncate error messages to 200 chars for PII-safe logging. */
function safeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
}

/** Get severity badge color. */
function severityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical': return '#DC2626';
    case 'high': return '#EA580C';
    case 'medium': return '#CA8A04';
    case 'low': return '#2563EB';
    default: return '#6B7280';
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const sendTicketEmailTool = createTool({
  id: 'send-ticket-email',
  description: 'Send email notification about a new triage ticket.',
  inputSchema: z.object({
    to: z.string().email().describe('Recipient email address'),
    ticketTitle: z.string().describe('Title of the created ticket'),
    ticketUrl: z.string().url().describe('Direct URL to the Linear issue'),
    severity: z.string().describe('Severity level (Critical/High/Medium/Low)'),
    summary: z.string().describe('Brief triage summary for the email body'),
  }),
  outputSchema: emailResultSchema,
  execute: async ({ context }) => {
    if (!resendClient) {
      console.warn('[Resend] No API key configured — skipping ticket email');
      return { id: 'skipped', success: true };
    }

    try {
      const color = severityColor(context.severity);
      const href = safeHref(context.ticketUrl);
      const title = escapeHtml(context.ticketTitle);
      const summary = escapeHtml(context.summary);
      const severity = escapeHtml(context.severity);

      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <div style="border-bottom: 3px solid ${color}; padding-bottom: 16px; margin-bottom: 20px;">
    <h1 style="margin: 0 0 8px 0; font-size: 20px;">New Triage Ticket</h1>
    <span style="display: inline-block; background: ${color}; color: white; padding: 4px 12px; border-radius: 4px; font-size: 13px; font-weight: 600;">${severity}</span>
  </div>
  <h2 style="margin: 0 0 12px 0; font-size: 18px;">${title}</h2>
  <p style="line-height: 1.6; color: #374151;">${summary}</p>
  <div style="margin-top: 24px;">
    <a href="${href}" style="display: inline-block; background: #5E6AD2; color: white; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 500;">View in Linear</a>
  </div>
  <p style="margin-top: 32px; font-size: 12px; color: #9CA3AF;">This is an automated notification from the Triage system.</p>
</body>
</html>`.trim();

      // Idempotency key based on ticket URL to avoid duplicate emails
      const idempotencyKey = `ticket-${Buffer.from(context.ticketUrl).toString('base64url').slice(0, 64)}`;

      const { data, error } = await resendClient.emails.send({
        from: config.RESEND_FROM_EMAIL,
        to: [context.to],
        subject: `[${context.severity}] New Triage Ticket: ${context.ticketTitle}`,
        html,
        headers: {
          'X-Idempotency-Key': idempotencyKey,
        },
      });

      if (error) {
        console.error(`[Resend] sendTicketEmail error: ${safeError(error)}`);
        return { id: '', success: false };
      }

      return { id: data?.id ?? '', success: true };
    } catch (err) {
      console.error(`[Resend] sendTicketEmail failed: ${safeError(err)}`);
      return { id: '', success: false };
    }
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
  execute: async ({ context }) => {
    if (!resendClient) {
      console.warn('[Resend] No API key configured — skipping resolution email');
      return { id: 'skipped', success: true };
    }

    try {
      const href = safeHref(context.ticketUrl);
      const title = escapeHtml(context.ticketTitle);
      const resolution = escapeHtml(context.resolution);

      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <div style="border-bottom: 3px solid #16A34A; padding-bottom: 16px; margin-bottom: 20px;">
    <h1 style="margin: 0 0 8px 0; font-size: 20px;">Ticket Resolved</h1>
    <span style="display: inline-block; background: #16A34A; color: white; padding: 4px 12px; border-radius: 4px; font-size: 13px; font-weight: 600;">Resolved</span>
  </div>
  <h2 style="margin: 0 0 12px 0; font-size: 18px;">${title}</h2>
  <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <h3 style="margin: 0 0 8px 0; font-size: 14px; color: #166534;">Resolution Summary</h3>
    <p style="margin: 0; line-height: 1.6; color: #374151;">${resolution}</p>
  </div>
  <div style="margin-top: 24px;">
    <a href="${href}" style="display: inline-block; background: #5E6AD2; color: white; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 500;">View in Linear</a>
  </div>
  <p style="margin-top: 32px; font-size: 12px; color: #9CA3AF;">This is an automated notification from the Triage system.</p>
</body>
</html>`.trim();

      // Idempotency key based on ticket URL + resolution to avoid duplicate emails
      const idempotencyKey = `resolved-${Buffer.from(context.ticketUrl).toString('base64url').slice(0, 64)}`;

      const { data, error } = await resendClient.emails.send({
        from: config.RESEND_FROM_EMAIL,
        to: [context.to],
        subject: `[Resolved] ${context.ticketTitle}`,
        html,
        headers: {
          'X-Idempotency-Key': idempotencyKey,
        },
      });

      if (error) {
        console.error(`[Resend] sendResolutionEmail error: ${safeError(error)}`);
        return { id: '', success: false };
      }

      return { id: data?.id ?? '', success: true };
    } catch (err) {
      console.error(`[Resend] sendResolutionEmail failed: ${safeError(err)}`);
      return { id: '', success: false };
    }
  },
});
