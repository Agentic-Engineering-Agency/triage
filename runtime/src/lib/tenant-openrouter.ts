import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { RequestContext } from '@mastra/core/request-context';
import { resolveKey } from './tenant-keys';

/**
 * Tenant-aware OpenRouter client resolution.
 *
 * Builds a fresh `createOpenRouter(...)` factory per call, with the API key
 * resolved via `resolveKey('openrouter', projectId)`. Used anywhere a model
 * instance is constructed — agents (`model:` dynamic), tools that invoke the
 * AI SDK directly (`attachments.ts`), and wiki-rag embeddings.
 *
 * Two entry points:
 *   - `resolveOpenRouterFromContext({ requestContext })` — for agents, where
 *     Mastra injects the active requestContext. Reads `projectId` off it.
 *   - `resolveOpenRouterFromProjectId(projectId)` — for code paths where the
 *     project id is threaded through arguments (wiki-rag pipeline, tool ctx).
 *
 * Both return the `createOpenRouter` factory — the caller invokes it with the
 * specific model id (e.g. `factory(MODELS.mercury, { extraBody })`). When no
 * key resolves anywhere, the factory is built with `apiKey: undefined` so the
 * provider tier throws a clear 401 instead of us silently masking the miss.
 */

export type OpenRouterFactory = ReturnType<typeof createOpenRouter>;

export async function resolveOpenRouterFromProjectId(
  projectId: string | null | undefined,
): Promise<OpenRouterFactory> {
  const { key } = await resolveKey('openrouter', projectId);
  return createOpenRouter({ apiKey: key ?? undefined });
}

export async function resolveOpenRouterFromContext(args: {
  requestContext?: RequestContext;
}): Promise<OpenRouterFactory> {
  const projectId = args.requestContext?.get('projectId') as string | undefined;
  return resolveOpenRouterFromProjectId(projectId);
}
