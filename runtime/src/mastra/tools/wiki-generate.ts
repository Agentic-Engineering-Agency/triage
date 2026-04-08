import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Inline Zod schemas for the wiki generation tool.
// Canonical location: @/lib/schemas/wiki.ts (wikiDocumentSchema, wikiChunkSchema)
// This tool triggers the two-pass wiki analysis pipeline and returns stats.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const generateWikiTool = createTool({
  id: 'generate-wiki',
  description:
    'Generate or refresh the codebase wiki from a git repository using two-pass analysis.',
  inputSchema: z.object({
    repositoryUrl: z
      .string()
      .url()
      .describe('Git repository URL (HTTPS) to analyse'),
    branch: z
      .string()
      .optional()
      .describe('Branch to analyse; defaults to the repo default branch'),
  }),
  outputSchema: z.object({
    documentsProcessed: z
      .number()
      .int()
      .describe('Number of source files processed'),
    chunksCreated: z
      .number()
      .int()
      .describe('Total embedding chunks stored'),
    success: z.boolean(),
  }),
  execute: async () => {
    throw new Error('Not implemented yet');
  },
});
