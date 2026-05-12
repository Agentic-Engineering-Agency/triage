import { z } from 'zod';

export const integrationProviderSchema = z.enum([
  'linear',
  'resend',
  'slack',
  'github',
  'openrouter',
]);
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

export const integrationStatusSchema = z.enum(['active', 'disabled', 'invalid']);
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

/**
 * Non-secret per-provider metadata (team ids, channel names, from domains).
 * Kept flat and string-valued on purpose: each provider parses this against
 * its own richer schema at the boundary where it's used.
 */
export const integrationMetaSchema = z.record(z.string(), z.string());
export type IntegrationMeta = z.infer<typeof integrationMetaSchema>;
