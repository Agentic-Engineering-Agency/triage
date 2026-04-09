import { z } from 'zod';

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

  // Langfuse (optional — observability is not required for core function)
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASEURL: z.string().optional(),
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

/**
 * Model identifiers used across the runtime.
 *
 * - mercury: Fast text generation, research, summarization. TEXT-ONLY.
 * - vision: Multimodal understanding (images, screenshots). Gemma 4 31B.
 * - visionFallback: Paid Gemma 4 — used when free tier is rate-limited.
 */
export const MODELS = {
  /** inception/mercury-2 — fast text, structured output, reasoning. TEXT-ONLY. */
  mercury: 'inception/mercury-2' as const,
  /** google/gemma-4-31b-it:free — multimodal vision (free tier) */
  vision: 'google/gemma-4-31b-it:free' as const,
  /** google/gemma-4-31b-it — multimodal vision (paid fallback) */
  visionFallback: 'google/gemma-4-31b-it' as const,
} as const;
