import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { queryWiki } from '../../lib/wiki-rag';

const wikiChunkResultSchema = z.object({
  chunkId: z.string().describe('wiki_chunks row ID'),
  documentId: z.string().describe('Parent wiki_documents row ID'),
  filePath: z.string().describe('Source file path in the repository'),
  content: z.string().describe('Chunk text content'),
  score: z.number().describe('Vector similarity score (0–1)'),
  summary: z.string().nullable().describe('Parent document summary'),
});

const wikiQueryResultSchema = z.object({
  results: z.array(wikiChunkResultSchema),
  query: z.string().describe('The original query string'),
  totalResults: z.number().int().describe('Number of results returned'),
});

export const queryWikiTool = createTool({
  id: 'query-wiki',
  description:
    'Query the codebase wiki using RAG vector search for relevant code context.',
  inputSchema: z.object({
    query: z.string().describe('Natural language search query'),
    projectId: z.string().optional().describe('Project ID to scope results to'),
    topK: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe('Number of top results to return'),
  }),
  outputSchema: wikiQueryResultSchema,
  execute: async (
    input: { context: Record<string, unknown> } | Record<string, unknown>,
    toolCtx?: { requestContext?: { get: (key: string) => unknown } },
  ) => {
    const ctx = (input?.context ?? input) as Record<string, unknown>;
    const query = ctx.query as string;
    // Fall back to requestContext.projectId when the LLM forgets to pass it —
    // guarantees per-project scoping in multi-project setups even if the
    // system prompt's projectId hint gets stripped or ignored.
    const explicitProjectId = ctx.projectId as string | undefined;
    const contextProjectId = toolCtx?.requestContext?.get('projectId') as string | undefined;
    const projectId = explicitProjectId ?? contextProjectId;
    const topK = (ctx.topK as number) || 10;

    try {
      return await queryWiki(query, projectId, topK);
    } catch (error: unknown) {
      console.error('[wiki-query] Error:', error instanceof Error ? error.message : 'Unknown');
      return { results: [], query, totalResults: 0 };
    }
  },
});
