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
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),

  // Slack (optional — graceful degradation if not configured)
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_CHANNEL_ID: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  // Langfuse (optional — observability is not required for core function)
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASEURL: z.string().optional(),

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
  RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
  RESEND_FROM_EMAIL: (fromEmail && z.string().email().safeParse(fromEmail).success) ? fromEmail : 'triage@agenticengineering.lat',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || undefined,
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || undefined,
  SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID || undefined,
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET || undefined,
};

// ============================================================
// Linear constants (from Koki's Linear/Resend integration)
// ============================================================

export const LINEAR_BASE_URL = 'https://linear.app/agentic-engineering-agency';

export const LINEAR_CONSTANTS = {
  TEAM_ID: '645a639b-39e2-4abe-8ded-3346d2f79f9f',

  STATES: {
    TRIAGE: '582398ee-98b0-406b-b2f6-8bca23c1b607',
    BACKLOG: 'b4bc738c-c3a5-4355-a3fe-72d183ec21ee',
    TODO: '3b9b9b60-e6eb-4914-9e1d-f3c8ce1eba0c',
    IN_PROGRESS: '889e861e-3bd6-4f98-888d-3e976ee583e9',
    IN_REVIEW: '1b1e7e58-03e7-4bb9-be10-669444e7b377',
    DONE: '0b0ac11a-a9c1-46d9-a10a-dabb935b53af',
    DUPLICATE: '5a98d91e-773d-4301-a966-1398ae99b906',
    CANCELED: '19d1f436-5f3e-420b-a197-f31cfd2636f6',
  },

  SEVERITY_LABELS: {
    CRITICAL: '60a50b72-d1c2-4823-9111-f85f345138d7',
    HIGH: '500cd0cb-2501-43e9-ad91-fba598d40a54',
    MEDIUM: 'bca8aa2f-e32b-49a3-9bc4-18a33c4c832e',
    LOW: '28fe88b4-88fa-4cd5-a35d-dcec4e4df82d',
  },

  CATEGORY_LABELS: {
    BUG: 'f599da19-8743-4569-a110-a666dc588811',
    FEATURE: '909d247a-40f4-48d5-a104-c238cc2ab45b',
    IMPROVEMENT: '50756390-d166-4b79-a740-ceefb203751f',
  },

  MEMBERS: {
    FERNANDO: { linearId: '90b16a9c-3f47-49fc-8d98-abf3aa6ecb13', slackId: process.env.SLACK_USER_FERNANDO || '', name: 'Fernando' },
    KOKI: { linearId: 'c3f725e4-aa51-45d3-af43-d29a87077226', slackId: process.env.SLACK_USER_KOKI || '', name: 'Koki' },
    CHENKO: { linearId: '7d177d95-4df7-4dff-a3df-710f49eba663', slackId: process.env.SLACK_USER_CHENKO || '', name: 'Chenko' },
    LALO: { linearId: 'b17c4757-ceef-4a13-b3c4-fc2ae09d50de', slackId: process.env.SLACK_USER_LALO || '', name: 'Lalo' },
  },
} as const;
