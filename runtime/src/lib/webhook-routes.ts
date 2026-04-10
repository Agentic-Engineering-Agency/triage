/**
 * Webhook routes — handlers for external service callbacks.
 *
 * Routes:
 *   POST /webhooks/linear  — receive Linear issue status change webhooks
 *   POST /webhooks/resume  — manually resume a suspended workflow run
 */
import { registerApiRoute } from '@mastra/core/server';

// ---------- POST /webhooks/linear ----------
export const linearWebhookRoute = registerApiRoute('/webhooks/linear', {
  method: 'POST',
  handler: async (c) => {
    try {
      const payload = await c.req.json();

      const { action, type, data } = payload as {
        action: string;
        type: string;
        data: {
          id: string;
          identifier: string;
          state: { name: string; type: string };
          url: string;
        };
      };

      // Only process issue update events
      if (type !== 'Issue' || action !== 'update') {
        return c.json({ success: true, received: true, skipped: true });
      }

      const identifier = data?.identifier ?? data?.id ?? 'unknown';
      const newStatus = data?.state?.name ?? 'unknown';

      console.log(`[webhook] Linear issue ${identifier} → ${newStatus}`);

      // Access the Mastra instance from the Hono context
      const mastra = c.get('mastra');

      if (mastra) {
        const workflow = mastra.getWorkflow('triage-workflow');
        console.log(
          `[webhook] Workflow reference obtained: ${!!workflow}. ` +
            `Full resume requires mapping issueId → runId (not yet implemented).`,
        );
      }

      return c.json({ success: true, received: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error processing webhook';
      console.error('[webhook] Error processing Linear webhook:', message);
      return c.json(
        { success: false, error: { code: 'WEBHOOK_ERROR', message } },
        500,
      );
    }
  },
});

// ---------- POST /webhooks/resume ----------
export const manualResumeRoute = registerApiRoute('/webhooks/resume', {
  method: 'POST',
  handler: async (c) => {
    try {
      const body = await c.req.json();
      const { runId, newStatus, deployUrl } = body as {
        runId: string;
        newStatus: string;
        deployUrl?: string;
      };

      if (!runId || !newStatus) {
        return c.json(
          {
            success: false,
            error: { code: 'VALIDATION', message: 'runId and newStatus are required' },
          },
          400,
        );
      }

      const mastra = c.get('mastra');

      if (!mastra) {
        return c.json(
          {
            success: false,
            error: { code: 'INTERNAL', message: 'Mastra instance not available' },
          },
          500,
        );
      }

      const workflow = mastra.getWorkflow('triage-workflow');
      const run = await workflow.createRun({ runId });

      console.log(`[webhook] Manual resume for runId=${runId}, newStatus=${newStatus}`);

      const result = await run.resume({
        step: 'suspend',
        resumeData: {
          newStatus,
          updatedAt: new Date().toISOString(),
          deployUrl,
        },
      });

      return c.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error resuming workflow';
      console.error('[webhook] Error resuming workflow:', message);
      return c.json(
        { success: false, error: { code: 'RESUME_ERROR', message } },
        500,
      );
    }
  },
});

export const webhookRoutes = [linearWebhookRoute, manualResumeRoute];
