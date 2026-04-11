/**
 * LLM usage logging helper.
 *
 * Calculates cost via the pricing module and inserts a row
 * into the `llm_usage` table. Designed to be called from
 * Mastra hooks or agent wrappers after each LLM call completes.
 */
import { createClient } from '@libsql/client';
import crypto from 'crypto';
import { calculateCost } from './provider-pricing';

function getDb() {
  return createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
}

export interface UsageLogEntry {
  projectId?: string;
  agentId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs?: number;
  threadId?: string;
}

/**
 * Log a single LLM usage event.
 *
 * Calculates cost from the pricing module, generates an ID,
 * and inserts into the `llm_usage` table.
 *
 * This function is fire-and-forget safe — errors are caught
 * and logged rather than thrown.
 */
export async function logUsage(entry: UsageLogEntry): Promise<void> {
  try {
    const db = getDb();
    const id = crypto.randomUUID();
    const costUsd = calculateCost(entry.model, entry.inputTokens, entry.outputTokens);
    const now = Date.now();

    await db.execute({
      sql: `INSERT INTO llm_usage (id, project_id, agent_id, model, input_tokens, output_tokens, cost_usd, duration_ms, thread_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        entry.projectId ?? null,
        entry.agentId,
        entry.model,
        entry.inputTokens,
        entry.outputTokens,
        costUsd,
        entry.durationMs ?? null,
        entry.threadId ?? null,
        now,
      ],
    });

    console.log(
      `[usage-logger] Logged: agent=${entry.agentId} model=${entry.model} in=${entry.inputTokens} out=${entry.outputTokens} cost=$${costUsd.toFixed(6)}`
    );
  } catch (error) {
    console.error('[usage-logger] Failed to log usage:', error instanceof Error ? error.message : String(error));
  }
}
