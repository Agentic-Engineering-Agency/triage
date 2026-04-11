/**
 * Provider pricing and cost calculation for OpenRouter models.
 *
 * Prices are in USD per 1M tokens, sourced from OpenRouter's published pricing.
 * Free-tier models are priced at 0.
 */

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

/**
 * Pricing map for all models used across the runtime.
 * Keys match the model IDs in config.ts MODELS object.
 *
 * Free models (:free suffix) = 0 cost.
 * Paid model pricing from OpenRouter (as of 2026-Q1):
 *   - qwen/qwen3.6-plus: $0.80 / $2.00 per 1M tokens
 *   - inception/mercury-2: $0.25 / $1.00 per 1M tokens
 *   - google/gemma-4-31b-it (paid): $0.15 / $0.15 per 1M tokens
 *   - openrouter/auto: estimates based on average free-tier routing
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Primary orchestrator (paid)
  'qwen/qwen3.6-plus': { inputPer1M: 0.80, outputPer1M: 2.00 },

  // Free orchestrator fallbacks
  'qwen/qwen3-235b-a22b:free': { inputPer1M: 0, outputPer1M: 0 },
  'deepseek/deepseek-chat-v3-0324:free': { inputPer1M: 0, outputPer1M: 0 },

  // Mercury sub-agent (paid)
  'inception/mercury-2': { inputPer1M: 0.25, outputPer1M: 1.00 },

  // Legacy mercury model (if still referenced)
  'inception/mercury-coder-small': { inputPer1M: 0.25, outputPer1M: 1.00 },

  // Vision — free tier
  'google/gemma-4-31b-it:free': { inputPer1M: 0, outputPer1M: 0 },
  'google/gemma-3-27b-it:free': { inputPer1M: 0, outputPer1M: 0 },

  // Vision — paid fallback
  'google/gemma-4-31b-it': { inputPer1M: 0.15, outputPer1M: 0.15 },

  // Auto router (estimated average — mostly routes to free models)
  'openrouter/auto': { inputPer1M: 0, outputPer1M: 0 },
};

/**
 * Calculate the cost of an LLM call in USD.
 *
 * @param model - The OpenRouter model ID
 * @param inputTokens - Number of input (prompt) tokens
 * @param outputTokens - Number of output (completion) tokens
 * @returns Cost in USD (0 for unknown/free models)
 */
export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    // Unknown model — log a warning and return 0
    console.warn(`[provider-pricing] No pricing found for model: ${model}`);
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;

  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6 decimal precision
}

/**
 * Human-friendly display name for a model ID.
 *
 * Strips the provider prefix and `:free` suffix for cleaner UI display.
 */
export function getModelDisplayName(modelId: string): string {
  const displayNames: Record<string, string> = {
    'qwen/qwen3.6-plus': 'Qwen 3.6 Plus',
    'qwen/qwen3-235b-a22b:free': 'Qwen3 235B (free)',
    'deepseek/deepseek-chat-v3-0324:free': 'DeepSeek V3 (free)',
    'inception/mercury-2': 'Mercury 2',
    'inception/mercury-coder-small': 'Mercury Coder Small',
    'google/gemma-4-31b-it:free': 'Gemma 4 31B (free)',
    'google/gemma-4-31b-it': 'Gemma 4 31B',
    'google/gemma-3-27b-it:free': 'Gemma 3 27B (free)',
    'openrouter/auto': 'OpenRouter Auto',
  };

  return displayNames[modelId] ?? modelId;
}
