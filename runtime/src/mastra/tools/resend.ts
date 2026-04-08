import { createTool } from '@mastra/core/tools';
import { Resend } from 'resend';
import { config } from '../../lib/config';
import { ticketNotificationSchema, resolutionNotificationSchema } from '../../lib/schemas/ticket';

// HTML escape helper to prevent XSS in email templates (C3)
function escapeHtml(s: string): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

// Validate URL starts with https://
function safeHref(url: string): string {
  if (url && url.startsWith('https://')) return url;
  return '#';
}

// Module-level singleton (REQ-6)
// Only instantiate if API key is configured (M5)
const resendClient = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;

const FROM_EMAIL = config.RESEND_FROM_EMAIL || 'triage@agenticengineering.lat';

// ---------- Tool 6: sendTicketNotification ----------
export const sendTicketNotification = createTool({
  id: 'send-ticket-notification',
  description: 'Send an email notification to the assigned engineer about a new triage ticket.',
  inputSchema: ticketNotificationSchema,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input?.context ?? input) as Record<string, unknown>;
    if (!resendClient) {
      console.log(`[Resend] Skipping ticket notification to ${ctx.to}: "${ctx.ticketTitle}" (RESEND_API_KEY not configured)`);
      return { success: true };
    }
    try {
      const { data, error } = await resendClient.emails.send({
        from: `Triage <${FROM_EMAIL}>`,
        to: ctx.to as string,
        subject: `[${ctx.severity}] New Triage Ticket: ${ctx.ticketTitle}`,
        html: renderTicketNotificationHtml(ctx as { assigneeName: string; ticketTitle: string; severity: string; priority: number; summary: string; linearUrl: string }),
        headers: {
          'Idempotency-Key': `ticket-notify/${ctx.linearIssueId}`,
        },
      });

      if (error) {
        console.error('[Resend] API error:', error.message);
        return { success: false, error: `Resend error: ${error.message}` };
      }

      return { success: true, emailId: data?.id };
    } catch (error: unknown) {
      console.error('[Resend] API error:', error instanceof Error ? error.message : String(error));
      return { success: false, error: `Resend error: ${error instanceof Error ? error.message : String(error)}` };
    }
  },
});

// ---------- Tool 7: sendResolutionNotification ----------
export const sendResolutionNotification = createTool({
  id: 'send-resolution-notification',
  description: 'Send an email notification to reporter(s) that their issue has been resolved.',
  inputSchema: resolutionNotificationSchema,
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input?.context ?? input) as Record<string, unknown>;
    if (!resendClient) {
      console.log(`[Resend] Skipping resolution notification to ${ctx.to}: "${ctx.originalTitle}" (RESEND_API_KEY not configured)`);
      return { success: true };
    }
    try {
      const to = Array.isArray(ctx.to) ? ctx.to : [ctx.to];
      const { data, error } = await resendClient.emails.send({
        from: `Triage <${FROM_EMAIL}>`,
        to,
        subject: `[Resolved] ${ctx.originalTitle}`,
        html: renderResolutionNotificationHtml(ctx as { originalTitle: string; resolutionSummary: string; prLink?: string; linearUrl: string }),
        headers: {
          'Idempotency-Key': `resolution-notify/${ctx.linearIssueId}`,
        },
      });

      if (error) {
        console.error('[Resend] API error:', error.message);
        return { success: false, error: `Resend error: ${error.message}` };
      }

      return { success: true, emailId: data?.id };
    } catch (error: unknown) {
      console.error('[Resend] API error:', error instanceof Error ? error.message : String(error));
      return { success: false, error: `Resend error: ${error instanceof Error ? error.message : String(error)}` };
    }
  },
});

// ---------- HTML Renderers ----------

function renderTicketNotificationHtml(ctx: { assigneeName: string; ticketTitle: string; severity: string; priority: number; summary: string; linearUrl: string }): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>New Triage Ticket</h2><p>Hi ${escapeHtml(ctx.assigneeName)},</p><p>A new triage ticket has been assigned to you:</p><div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;"><h3>${escapeHtml(ctx.ticketTitle)}</h3><p><strong>Severity:</strong> ${escapeHtml(ctx.severity)}</p><p><strong>Priority:</strong> ${escapeHtml(String(ctx.priority))}</p><div>${escapeHtml(ctx.summary)}</div></div><p><a href="${safeHref(ctx.linearUrl)}">View in Linear</a></p><p style="color:#888;font-size:12px;">Sent by Triage (agenticengineering.lat)</p></body></html>`;
}

function renderResolutionNotificationHtml(ctx: { originalTitle: string; resolutionSummary: string; prLink?: string; linearUrl: string }): string {
  const prSection = ctx.prLink ? `<p><a href="${safeHref(ctx.prLink)}">View Pull Request</a></p>` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Issue Resolved</h2><p>Your reported issue has been resolved:</p><div style="background:#f0fdf4;padding:16px;border-radius:8px;margin:16px 0;"><h3>${escapeHtml(ctx.originalTitle)}</h3><p><strong>Resolution:</strong></p><div>${escapeHtml(ctx.resolutionSummary)}</div>${prSection}</div><p><a href="${safeHref(ctx.linearUrl)}">View in Linear</a></p><p style="color:#888;font-size:12px;">Sent by Triage (agenticengineering.lat)</p></body></html>`;
}
