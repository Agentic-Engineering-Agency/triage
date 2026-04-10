/**
 * Integration endpoints — per-project configuration for external services.
 *
 * Routes:
 *   POST /projects/:projectId/settings/linear/test       — validate Linear API token
 *   POST /projects/:projectId/settings/linear/webhook    — register Linear webhook for project
 *   POST /projects/:projectId/settings/github/test       — validate GitHub token
 *   POST /projects/:projectId/settings/slack/test        — validate Slack webhook URL
 *   GET  /projects/:projectId/settings/integrations      — get all integration configs
 */
import { registerApiRoute } from '@mastra/core/server';
import { createClient } from '@libsql/client';
import type { Context } from 'hono';

function getDb() {
  return createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
}

// Helper: verify project exists and return it
async function getProject(projectId: string) {
  const db = getDb();
  const result = await db.execute('SELECT * FROM projects WHERE id = ?', [projectId]);
  return result.rows[0] || null;
}

// Helper: update project integration config
async function updateProjectIntegration(projectId: string, updates: Record<string, unknown>) {
  const db = getDb();
  const setClause = Object.keys(updates)
    .map((key) => `${key} = ?`)
    .join(', ');
  const values = [...Object.values(updates), projectId];

  await db.execute(`UPDATE projects SET ${setClause}, updated_at = ? WHERE id = ?`, [
    ...values.slice(0, -1),
    Date.now(),
    projectId,
  ]);
}

// ---------- POST /projects/:projectId/settings/linear/test ----------
export const testLinearTokenRoute = registerApiRoute('/projects/:projectId/settings/linear/test', {
  method: 'POST',
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId');
      const body = (await c.req.json()) as { token?: string };

      if (!body.token) {
        return c.json({ success: false, error: { code: 'MISSING_TOKEN', message: 'token is required' } }, 400);
      }

      // Validate token by testing a simple API call
      const { LinearClient } = await import('@linear/sdk');
      const client = new LinearClient({ apiKey: body.token });

      try {
        const me = await client.viewer;
        if (!me) {
          return c.json(
            { success: false, error: { code: 'INVALID_TOKEN', message: 'Token is invalid or expired' } },
            401,
          );
        }

        // Save the token to the project
        const project = await getProject(projectId);
        if (!project) {
          return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
        }

        await updateProjectIntegration(projectId, { linear_token: body.token });

        return c.json({
          success: true,
          data: {
            valid: true,
            user: { id: me.id, name: me.name, email: me.email },
            message: 'Linear token is valid and saved',
          },
        });
      } catch {
        return c.json(
          { success: false, error: { code: 'TOKEN_ERROR', message: 'Failed to validate Linear token' } },
          401,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: { code: 'ERROR', message } }, 500);
    }
  },
});

// ---------- POST /projects/:projectId/settings/linear/webhook ----------
export const registerLinearWebhookRoute = registerApiRoute('/projects/:projectId/settings/linear/webhook', {
  method: 'POST',
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId');
      const body = (await c.req.json()) as { url?: string; teamId?: string };

      if (!body.url) {
        return c.json({ success: false, error: { code: 'MISSING_URL', message: 'url is required' } }, 400);
      }

      const project = await getProject(projectId);
      if (!project) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
      }

      if (!project.linear_token) {
        return c.json(
          {
            success: false,
            error: {
              code: 'NO_LINEAR_TOKEN',
              message: 'Linear token not configured for this project',
            },
          },
          400,
        );
      }

      // Register webhook with Linear
      const { LinearClient } = await import('@linear/sdk');
      const client = new LinearClient({ apiKey: project.linear_token as string });

      try {
        const result = await client.createWebhook({
          url: body.url,
          teamId: body.teamId || (project.linear_team_id as string),
          resourceTypes: ['Issue'],
          enabled: true,
        });

        const webhook = await result.webhook;
        if (!webhook) {
          return c.json(
            { success: false, error: { code: 'WEBHOOK_ERROR', message: 'Failed to create webhook' } },
            400,
          );
        }

        // Save webhook info
        await updateProjectIntegration(projectId, {
          linear_webhook_id: webhook.id,
          linear_webhook_url: webhook.url,
        });

        return c.json({
          success: true,
          data: {
            id: webhook.id,
            url: webhook.url,
            enabled: webhook.enabled,
            message: 'Webhook registered successfully',
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to register webhook';
        return c.json({ success: false, error: { code: 'WEBHOOK_ERROR', message } }, 400);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: { code: 'ERROR', message } }, 500);
    }
  },
});

// ---------- POST /projects/:projectId/settings/github/test ----------
export const testGithubTokenRoute = registerApiRoute('/projects/:projectId/settings/github/test', {
  method: 'POST',
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId');
      const body = (await c.req.json()) as { token?: string; owner?: string; repo?: string };

      if (!body.token) {
        return c.json({ success: false, error: { code: 'MISSING_TOKEN', message: 'token is required' } }, 400);
      }

      // Validate token with GitHub API
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `token ${body.token}`,
          'User-Agent': 'triage-app',
        },
      });

      if (!response.ok) {
        return c.json(
          { success: false, error: { code: 'INVALID_TOKEN', message: 'GitHub token is invalid or expired' } },
          401,
        );
      }

      const userData = (await response.json()) as { login?: string; name?: string };

      // Save the token
      const project = await getProject(projectId);
      if (!project) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
      }

      const updates: Record<string, unknown> = { github_token: body.token };
      if (body.owner) updates.github_repo_owner = body.owner;
      if (body.repo) updates.github_repo_name = body.repo;

      await updateProjectIntegration(projectId, updates);

      return c.json({
        success: true,
        data: {
          valid: true,
          user: { login: userData.login, name: userData.name },
          message: 'GitHub token is valid and saved',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: { code: 'ERROR', message } }, 500);
    }
  },
});

// ---------- POST /projects/:projectId/settings/slack/test ----------
export const testSlackWebhookRoute = registerApiRoute('/projects/:projectId/settings/slack/test', {
  method: 'POST',
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId');
      const body = (await c.req.json()) as { webhookUrl?: string; channelId?: string };

      if (!body.webhookUrl) {
        return c.json({ success: false, error: { code: 'MISSING_URL', message: 'webhookUrl is required' } }, 400);
      }

      // Test webhook by sending a message
      const testResponse = await fetch(body.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '✅ Triage integration configured successfully',
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: '*Triage Webhook Test*\nIntegration is working!' },
            },
          ],
        }),
      });

      if (!testResponse.ok) {
        return c.json(
          { success: false, error: { code: 'INVALID_URL', message: 'Slack webhook URL is invalid' } },
          401,
        );
      }

      // Save the webhook
      const project = await getProject(projectId);
      if (!project) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
      }

      const updates: Record<string, unknown> = {
        slack_enabled: 1,
        slack_webhook_url: body.webhookUrl,
      };
      if (body.channelId) updates.slack_channel_id = body.channelId;

      await updateProjectIntegration(projectId, updates);

      return c.json({
        success: true,
        data: {
          valid: true,
          message: 'Slack webhook is valid and saved',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: { code: 'ERROR', message } }, 500);
    }
  },
});

// ---------- GET /projects/:projectId/settings/integrations ----------
export const getIntegrationSettingsRoute = registerApiRoute('/projects/:projectId/settings/integrations', {
  method: 'GET',
  handler: async (c: Context) => {
    try {
      const projectId = c.req.param('projectId');
      const project = await getProject(projectId);

      if (!project) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
      }

      return c.json({
        success: true,
        data: {
          linear: {
            configured: !!project.linear_token,
            teamId: project.linear_team_id || null,
            webhookId: project.linear_webhook_id || null,
            webhookUrl: project.linear_webhook_url || null,
          },
          github: {
            configured: !!project.github_token,
            owner: project.github_repo_owner || null,
            repo: project.github_repo_name || null,
          },
          slack: {
            configured: !!project.slack_enabled,
            channelId: project.slack_channel_id || null,
            webhookUrl: project.slack_webhook_url ? '****' : null, // Don't expose full URL
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: { code: 'ERROR', message } }, 500);
    }
  },
});

export const integrationRoutes = [
  testLinearTokenRoute,
  registerLinearWebhookRoute,
  testGithubTokenRoute,
  testSlackWebhookRoute,
  getIntegrationSettingsRoute,
];
