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

export const LINEAR_CONSTANTS = {
  // TRI team (agentic-engineering-agency) — used as fallback only
  // Override with LINEAR_TEAM_ID env var
  TEAM_ID: config.LINEAR_TEAM_ID,

  // DEPRECATED: Use getLinearStates() instead
  STATES: {
    TRIAGE: 'bce0cec5-80ba-407e-aa98-248c380ce966',
    BACKLOG: 'a1b56fee-32c7-4c7d-b6cd-318380590a53',
    TODO: '52a97f3f-481b-40f9-8187-237dc282a47d',
    IN_PROGRESS: '3aba585d-1838-4a0e-9651-c4a2c9032dfb',
    IN_REVIEW: '3425bc21-40e6-457d-9b8a-4386e0509d79',
    DONE: '40c24407-f5d5-4489-b5ac-ef964373d954',
    DUPLICATE: '9f2f1444-3a4b-46db-858c-f643a6d5aecb',
    CANCELED: '6ff262e3-d016-4777-836b-1357cd535f73',
  },

  // DEPRECATED: Use getLinearLabels() instead
  SEVERITY_LABELS: {
    CRITICAL: '47785580-5256-4240-9f11-cde67e06a4c3',
    HIGH: 'eef1c6e5-f3c0-4b0f-9702-189748af77f0',
    MEDIUM: 'bd743933-cd2f-4b05-a832-669aefb2af77',
    LOW: 'f4350e9c-96ea-44f8-931a-4af52aacf3ed',
  },

  // DEPRECATED: Use getLinearLabels() instead
  CATEGORY_LABELS: {
    BUG: 'f599da19-8743-4569-a110-a666dc588811',
    FEATURE: '909d247a-40f4-48d5-a104-c238cc2ab45b',
    IMPROVEMENT: '50756390-d166-4b79-a740-ceefb203751f',
  },

  // DEPRECATED: Use getLinearTeamMembers() instead
  MEMBERS: {
    FERNANDO: { linearId: '90b16a9c-3f47-49fc-8d98-abf3aa6ecb13', slackId: process.env.SLACK_USER_FERNANDO || '', name: 'Fernando' },
    KOKI: { linearId: 'c3f725e4-aa51-45d3-af43-d29a87077226', slackId: process.env.SLACK_USER_KOKI || '', name: 'Koki' },
    CHENKO: { linearId: '7d177d95-4df7-4dff-a3df-710f49eba663', slackId: process.env.SLACK_USER_CHENKO || '', name: 'Chenko' },
    LALO: { linearId: 'b17c4757-ceef-4a13-b3c4-fc2ae09d50de', slackId: process.env.SLACK_USER_LALO || '', name: 'Lalo' },
  },
} as const;
