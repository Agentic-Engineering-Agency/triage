import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { wikiQueryResultSchema } from '../../lib/schemas';

export const queryWikiTool = createTool({
  id: 'query-wiki',
  description: 'Query the codebase wiki using RAG vector search for relevant code context.',
  inputSchema: z.object({
    query: z.string().describe('Natural language search query'),
    topK: z.number().int().min(1).max(50).optional().default(10).describe('Number of top results to return'),
  }),
  outputSchema: wikiQueryResultSchema,
  execute: async () => {
    throw new Error('Not implemented yet');
  },
});
