/**
 * Observability API routes — LLM usage tracking, cost breakdown, pricing info,
 * workflow runs, dashboard stats, and agent activity.
 *
 * Routes:
 *   GET /api/observability/usage     — usage aggregated by model and agent
 *   GET /api/observability/costs     — cost breakdown by model, by day, and total
 *   GET /api/observability/pricing   — current MODEL_PRICING data
 *   GET /api/observability/workflows — recent workflow runs list
 *   GET /api/observability/stats     — dashboard summary (runs + costs + tokens)
 *   GET /api/observability/agents    — agent activity summary grouped by agent_id
 */
import { registerApiRoute } from '@mastra/core/server';
import { createClient } from '@libsql/client';
import { MODEL_PRICING, getModelDisplayName } from './provider-pricing';

function getDb() {
  return createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
}

/**
 * Convert a period string to a timestamp cutoff (epoch ms).
 * Returns 0 for 'all' (no filter).
 */
function periodToTimestamp(period: string): number {
  const now = Date.now();
  switch (period) {
    case 'day':
      return now - 24 * 60 * 60 * 1000;
    case 'week':
      return now - 7 * 24 * 60 * 60 * 1000;
    case 'month':
      return now - 30 * 24 * 60 * 60 * 1000;
    case 'all':
    default:
      return 0;
  }
}

// ---------- GET /api/observability/usage ----------
export const usageRoute = registerApiRoute('/observability/usage', {
  method: 'GET',
  handler: async (c) => {
    try {
      const projectId = c.req.query('projectId');
      const period = c.req.query('period') || 'all';
      const since = periodToTimestamp(period);

      const db = getDb();

      // Build WHERE clause dynamically
      const conditions: string[] = [];
      const args: (string | number)[] = [];

      if (since > 0) {
        conditions.push('created_at >= ?');
        args.push(since);
      }
      if (projectId) {
        conditions.push('project_id = ?');
        args.push(projectId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Aggregate by model
      const byModel = await db.execute({
        sql: `SELECT model,
                     COUNT(*) as call_count,
                     SUM(input_tokens) as total_input_tokens,
                     SUM(output_tokens) as total_output_tokens,
                     SUM(cost_usd) as total_cost,
                     AVG(duration_ms) as avg_duration_ms
              FROM llm_usage ${whereClause}
              GROUP BY model
              ORDER BY total_cost DESC`,
        args,
      });

      // Aggregate by agent
      const byAgent = await db.execute({
        sql: `SELECT agent_id,
                     COUNT(*) as call_count,
                     SUM(input_tokens) as total_input_tokens,
                     SUM(output_tokens) as total_output_tokens,
                     SUM(cost_usd) as total_cost,
                     AVG(duration_ms) as avg_duration_ms
              FROM llm_usage ${whereClause}
              GROUP BY agent_id
              ORDER BY total_cost DESC`,
        args,
      });

      return c.json({
        success: true,
        data: {
          byModel: byModel.rows.map((row) => ({
            model: row.model as string,
            displayName: getModelDisplayName(row.model as string),
            callCount: Number(row.call_count),
            totalInputTokens: Number(row.total_input_tokens),
            totalOutputTokens: Number(row.total_output_tokens),
            totalCost: Number(row.total_cost),
            avgDurationMs: row.avg_duration_ms != null ? Math.round(Number(row.avg_duration_ms)) : null,
          })),
          byAgent: byAgent.rows.map((row) => ({
            agentId: row.agent_id as string,
            callCount: Number(row.call_count),
            totalInputTokens: Number(row.total_input_tokens),
            totalOutputTokens: Number(row.total_output_tokens),
            totalCost: Number(row.total_cost),
            avgDurationMs: row.avg_duration_ms != null ? Math.round(Number(row.avg_duration_ms)) : null,
          })),
          period,
          projectId: projectId ?? null,
        },
      });
    } catch (error) {
      console.error('[observability/usage] Error:', error instanceof Error ? error.message : String(error));
      const message = error instanceof Error ? error.message : 'Failed to fetch usage data';
      return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  },
});

// ---------- GET /api/observability/costs ----------
export const costsRoute = registerApiRoute('/observability/costs', {
  method: 'GET',
  handler: async (c) => {
    try {
      const projectId = c.req.query('projectId');
      const period = c.req.query('period') || 'all';
      const since = periodToTimestamp(period);

      const db = getDb();

      const conditions: string[] = [];
      const args: (string | number)[] = [];

      if (since > 0) {
        conditions.push('created_at >= ?');
        args.push(since);
      }
      if (projectId) {
        conditions.push('project_id = ?');
        args.push(projectId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Cost by model
      const byModel = await db.execute({
        sql: `SELECT model,
                     SUM(cost_usd) as total_cost,
                     SUM(input_tokens) as total_input,
                     SUM(output_tokens) as total_output,
                     COUNT(*) as call_count
              FROM llm_usage ${whereClause}
              GROUP BY model
              ORDER BY total_cost DESC`,
        args,
      });

      // Cost by day (using date from epoch ms timestamp)
      // SQLite date extraction from epoch ms: datetime(created_at/1000, 'unixepoch')
      const byDay = await db.execute({
        sql: `SELECT date(created_at / 1000, 'unixepoch') as day,
                     SUM(cost_usd) as total_cost,
                     SUM(input_tokens) as total_input_tokens,
                     SUM(output_tokens) as total_output_tokens,
                     COUNT(*) as call_count
              FROM llm_usage ${whereClause}
              GROUP BY day
              ORDER BY day DESC`,
        args,
      });

      // Total cost
      const totalResult = await db.execute({
        sql: `SELECT SUM(cost_usd) as total_cost,
                     SUM(input_tokens) as total_input_tokens,
                     SUM(output_tokens) as total_output_tokens,
                     COUNT(*) as call_count
              FROM llm_usage ${whereClause}`,
        args,
      });

      const totalRow = totalResult.rows[0];

      return c.json({
        success: true,
        data: {
          byModel: byModel.rows.map((row) => ({
            model: row.model as string,
            displayName: getModelDisplayName(row.model as string),
            totalCost: Number(row.total_cost ?? 0),
            totalInput: Number(row.total_input ?? 0),
            totalOutput: Number(row.total_output ?? 0),
            callCount: Number(row.call_count),
          })),
          byDay: byDay.rows.map((row) => ({
            day: row.day as string,
            totalCost: Number(row.total_cost),
            totalInputTokens: Number(row.total_input_tokens),
            totalOutputTokens: Number(row.total_output_tokens),
            callCount: Number(row.call_count),
          })),
          totals: {
            totalCost: Number(totalRow?.total_cost ?? 0),
            totalInput: Number(totalRow?.total_input_tokens ?? 0),
            totalOutput: Number(totalRow?.total_output_tokens ?? 0),
            totalCalls: Number(totalRow?.call_count ?? 0),
          },
          period,
          projectId: projectId ?? null,
        },
      });
    } catch (error) {
      console.error('[observability/costs] Error:', error instanceof Error ? error.message : String(error));
      const message = error instanceof Error ? error.message : 'Failed to fetch cost data';
      return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  },
});

// ---------- GET /api/observability/pricing ----------
export const pricingRoute = registerApiRoute('/observability/pricing', {
  method: 'GET',
  handler: async (c) => {
    const pricing = Object.entries(MODEL_PRICING).map(([modelId, prices]) => ({
      modelId,
      displayName: getModelDisplayName(modelId),
      inputPer1M: prices.inputPer1M,
      outputPer1M: prices.outputPer1M,
      isFree: prices.inputPer1M === 0 && prices.outputPer1M === 0,
    }));

    return c.json({ success: true, data: { models: pricing } });
  },
});

// ---------- GET /api/observability/workflows ----------
export const workflowsRoute = registerApiRoute('/observability/workflows', {
  method: 'GET',
  handler: async (c) => {
    try {
      const projectId = c.req.query('projectId');
      const status = c.req.query('status');
      const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);

      const db = getDb();

      const conditions: string[] = [];
      const args: (string | number)[] = [];

      if (status) {
        conditions.push('wr.status = ?');
        args.push(status);
      }

      // workflow_runs doesn't have project_id, but we can join through
      // llm_usage thread_id if a projectId filter is requested
      if (projectId) {
        conditions.push(
          `wr.thread_id IN (SELECT DISTINCT thread_id FROM llm_usage WHERE project_id = ? AND thread_id IS NOT NULL)`,
        );
        args.push(projectId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      args.push(limit);

      const result = await db.execute({
        sql: `SELECT wr.run_id, wr.thread_id, wr.issue_id, wr.issue_url, wr.status, wr.created_at
              FROM workflow_runs wr
              ${whereClause}
              ORDER BY wr.created_at DESC
              LIMIT ?`,
        args,
      });

      return c.json({
        success: true,
        data: result.rows.map((row) => ({
          runId: row.run_id as string,
          threadId: row.thread_id as string,
          issueId: (row.issue_id as string) ?? null,
          issueUrl: (row.issue_url as string) ?? null,
          status: row.status as string,
          createdAt: Number(row.created_at),
        })),
      });
    } catch (error) {
      console.error('[observability/workflows] Error:', error instanceof Error ? error.message : String(error));
      const message = error instanceof Error ? error.message : 'Failed to fetch workflow runs';
      return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  },
});

// ---------- GET /api/observability/stats ----------
export const statsRoute = registerApiRoute('/observability/stats', {
  method: 'GET',
  handler: async (c) => {
    try {
      const projectId = c.req.query('projectId');
      const period = c.req.query('period') || 'all';
      const since = periodToTimestamp(period);

      const db = getDb();

      // --- Workflow run stats ---
      const wrConditions: string[] = [];
      const wrArgs: (string | number)[] = [];

      if (since > 0) {
        wrConditions.push('created_at >= ?');
        wrArgs.push(since);
      }

      const wrWhere = wrConditions.length > 0 ? `WHERE ${wrConditions.join(' AND ')}` : '';

      const totalRunsResult = await db.execute({
        sql: `SELECT COUNT(*) as total FROM workflow_runs ${wrWhere}`,
        args: wrArgs,
      });

      const runsByStatusResult = await db.execute({
        sql: `SELECT status, COUNT(*) as count FROM workflow_runs ${wrWhere} GROUP BY status`,
        args: wrArgs,
      });

      const totalRuns = Number(totalRunsResult.rows[0]?.total ?? 0);
      const runsByStatus: Record<string, number> = { running: 0, suspended: 0, completed: 0 };
      for (const row of runsByStatusResult.rows) {
        const s = row.status as string;
        runsByStatus[s] = Number(row.count);
      }

      // --- LLM usage stats ---
      const usageConditions: string[] = [];
      const usageArgs: (string | number)[] = [];

      if (since > 0) {
        usageConditions.push('created_at >= ?');
        usageArgs.push(since);
      }
      if (projectId) {
        usageConditions.push('project_id = ?');
        usageArgs.push(projectId);
      }

      const usageWhere = usageConditions.length > 0 ? `WHERE ${usageConditions.join(' AND ')}` : '';

      const usageTotals = await db.execute({
        sql: `SELECT SUM(cost_usd) as total_cost,
                     SUM(input_tokens + output_tokens) as total_tokens,
                     COUNT(*) as total_calls
              FROM llm_usage ${usageWhere}`,
        args: usageArgs,
      });

      const usageRow = usageTotals.rows[0];

      return c.json({
        success: true,
        data: {
          totalRuns,
          runsByStatus,
          totalCost: Number(usageRow?.total_cost ?? 0),
          totalTokens: Number(usageRow?.total_tokens ?? 0),
          totalCalls: Number(usageRow?.total_calls ?? 0),
          period,
          projectId: projectId ?? null,
        },
      });
    } catch (error) {
      console.error('[observability/stats] Error:', error instanceof Error ? error.message : String(error));
      const message = error instanceof Error ? error.message : 'Failed to fetch stats';
      return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  },
});

// ---------- GET /api/observability/agents ----------
export const agentsRoute = registerApiRoute('/observability/agents', {
  method: 'GET',
  handler: async (c) => {
    try {
      const projectId = c.req.query('projectId');
      const period = c.req.query('period') || 'all';
      const since = periodToTimestamp(period);

      const db = getDb();

      const conditions: string[] = [];
      const args: (string | number)[] = [];

      if (since > 0) {
        conditions.push('created_at >= ?');
        args.push(since);
      }
      if (projectId) {
        conditions.push('project_id = ?');
        args.push(projectId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await db.execute({
        sql: `SELECT agent_id,
                     COUNT(*) as total_calls,
                     SUM(input_tokens) as total_input_tokens,
                     SUM(output_tokens) as total_output_tokens,
                     SUM(cost_usd) as total_cost,
                     AVG(duration_ms) as avg_duration_ms
              FROM llm_usage ${whereClause}
              GROUP BY agent_id
              ORDER BY total_cost DESC`,
        args,
      });

      return c.json({
        success: true,
        data: result.rows.map((row) => ({
          agentId: row.agent_id as string,
          totalCalls: Number(row.total_calls),
          totalInputTokens: Number(row.total_input_tokens),
          totalOutputTokens: Number(row.total_output_tokens),
          totalCost: Number(row.total_cost),
          avgDurationMs: row.avg_duration_ms != null ? Math.round(Number(row.avg_duration_ms)) : null,
        })),
      });
    } catch (error) {
      console.error('[observability/agents] Error:', error instanceof Error ? error.message : String(error));
      const message = error instanceof Error ? error.message : 'Failed to fetch agent metrics';
      return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  },
});

export const observabilityRoutes = [usageRoute, costsRoute, pricingRoute, workflowsRoute, statsRoute, agentsRoute];
