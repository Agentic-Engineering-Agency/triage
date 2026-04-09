import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Inline Zod schemas mirroring canonical definitions.
// Canonical location: @/lib/schemas/wiki.ts (wikiDocumentSchema, wikiChunkSchema)
// The output schema here mirrors a "wikiQueryResultSchema" that the wiki RAG
// query tool returns — an array of scored chunks with their parent document
// metadata.
// ---------------------------------------------------------------------------

const wikiChunkResultSchema = z.object({
  chunkId: z.string().describe('wiki_chunks row ID'),
  documentId: z.string().describe('Parent wiki_documents row ID'),
  filePath: z.string().describe('Source file path in the repository'),
  content: z.string().describe('Chunk text content'),
  score: z.number().describe('Vector similarity score (0–1)'),
  summary: z.string().nullable().describe('Parent document summary (pass-1 or pass-2)'),
});

const wikiQueryResultSchema = z.object({
  results: z.array(wikiChunkResultSchema),
  query: z.string().describe('The original query string'),
  totalResults: z.number().int().describe('Number of results returned'),
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const queryWikiTool = createTool({
  id: 'query-wiki',
  description:
    'Query the codebase wiki using RAG vector search for relevant code context.',
  inputSchema: z.object({
    query: z.string().describe('Natural language search query'),
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
  execute: async ({ context }) => {
    // Wiki not yet populated — return empty results so triage continues without RAG context
    return { results: [], query: context.query, totalResults: 0 };
  },
});
