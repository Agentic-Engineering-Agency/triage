import { z } from 'zod';

// ============================================================
// Environment validation (from Lalo's runtime scaffold)
// ============================================================

/**
 * Runtime environment variable validation.
 *
 * Validates all required env vars at startup so we fail fast
 * with a clear error instead of crashing mid-request.
 */
const envSchema = z.object({
  // App
  PORT: z.string().default('4111'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LIBSQL_URL: z.string().url().default('http://libsql:8080'),

  // LLM — OpenRouter
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY is required'),

  // Integrations (optional at startup — required when tools are actually called)
  LINEAR_API_KEY: z.string().optional(),
  LINEAR_TEAM_ID: z.string().optional(), // Team UUID — falls back to TRI team if not set
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),

  // Slack (optional — graceful degradation if not configured)
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_CHANNEL_ID: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  // GitHub (optional — used for repo-aware triage)
  GITHUB_TOKEN: z.string().optional(),
});

/** Validated and typed environment config */
export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables.
 * Call this at startup to fail fast on misconfiguration.
 */
export function validateEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

// ============================================================
// Model identifiers (from Lalo's runtime scaffold)
// ============================================================

/**
 * Model identifiers used across the runtime.
 *
 * All orchestrator/agent models MUST support tool/function calling via OpenRouter.
 *
 * - orchestrator: Qwen 3.6 Plus (1M context, tools + vision, paid).
 * - orchestratorFallback1: Qwen3 235B MoE (free, 131K context, tools confirmed).
 * - orchestratorFallback2: DeepSeek V3 (free, 131K context, tools confirmed).
 * - mercury: Fast text generation, research, summarization. TEXT-ONLY.
 * - vision: Gemma 4 31B (free) — dedicated multimodal for image analysis.
 * - visionFallback: Paid Gemma 4 — used when free tier is rate-limited.
 * - freeRouter: OpenRouter auto-router fallback.
 */
export const MODELS = {
  /** qwen/qwen3.6-plus — primary orchestrator (1M context, tools + vision) */
  orchestrator: 'qwen/qwen3.6-plus',
  /** qwen/qwen3-235b-a22b:free — orchestrator fallback 1 (MoE 235B, tools confirmed) */
  orchestratorFallback1: 'qwen/qwen3-235b-a22b:free',
  /** deepseek/deepseek-chat-v3-0324:free — orchestrator fallback 2 (tools confirmed) */
  orchestratorFallback2: 'deepseek/deepseek-chat-v3-0324:free',
  /** inception/mercury-2 — fast text, structured output, reasoning. TEXT-ONLY. */
  mercury: 'inception/mercury-2',
  /** google/gemma-4-31b-it:free — multimodal vision (free tier) */
  vision: 'google/gemma-4-31b-it:free',
  /** google/gemma-4-31b-it — multimodal vision (paid fallback) */
  visionFallback: 'google/gemma-4-31b-it',
  /** openrouter/auto — free router fallback */
  freeRouter: 'openrouter/auto',
} as const;

/**
 * Fallback chains for each model role.
 * OpenRouter tries models in order until one succeeds.
 * Max 4 models per chain (OpenRouter limit).
 */
export const MODEL_CHAINS = {
  orchestrator: [MODELS.orchestrator, MODELS.orchestratorFallback1, MODELS.orchestratorFallback2],
  subAgent: [MODELS.mercury, MODELS.freeRouter],
  vision: [MODELS.vision, MODELS.visionFallback, MODELS.freeRouter],
} as const;

// ============================================================
// Simple runtime config (from Koki's Linear/Resend integration)
// ============================================================

// Validate RESEND_FROM_EMAIL if provided
const fromEmail = process.env.RESEND_FROM_EMAIL;
if (fromEmail !== undefined && fromEmail !== '') {
  const result = z.string().email().safeParse(fromEmail);
  if (!result.success) {
    console.warn(`[Config] Invalid RESEND_FROM_EMAIL value provided — using default`);
  }
}

export const config = {
  LINEAR_API_KEY: process.env.LINEAR_API_KEY || undefined,
  LINEAR_TEAM_ID: process.env.LINEAR_TEAM_ID || '645a639b-39e2-4abe-8ded-3346d2f79f9f', // Default: TRI team from agentic-engineering-agency
  RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
  RESEND_FROM_EMAIL: (fromEmail && z.string().email().safeParse(fromEmail).success) ? fromEmail : 'triage@agenticengineering.lat',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || undefined,
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || undefined,
  SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID || undefined,
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET || undefined,
};

// ============================================================
// Linear constants — DEPRECATED (use dynamic lookups instead)
// ============================================================
//
// MIGRATION: These hardcoded IDs are now FALLBACKS only.
//
// New code should use:
//   - getLinearStates(teamId, apiKey) from ./linear-constants.ts
//   - getLinearLabels(teamId, apiKey) from ./linear-constants.ts
//   - getLinearTeamMembers(teamId, apiKey) from ./linear-constants.ts
//
// This enables testing with any Linear workspace, not just agentic-engineering-agency.
// Old code still works but should migrate to dynamic lookups.

export const LINEAR_BASE_URL = 'https://linear.app/agentic-engineering-agency';

/**
 * Linear configuration — only the team ID is static (from env).
 * States, labels, and members are resolved dynamically via Linear API
 * using the helpers in src/lib/linear-constants.ts and
 * src/mastra/tools/linear-state-resolver.ts. This lets the system work
 * with any Linear workspace without hardcoded IDs.
 */
export const LINEAR_CONSTANTS = {
  TEAM_ID: config.LINEAR_TEAM_ID,
} as const;
