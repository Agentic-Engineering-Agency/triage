import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateWiki } from '../../lib/wiki-rag';

export const generateWikiTool = createTool({
  id: 'generate-wiki',
  description:
    'Generate or refresh the codebase wiki from a git repository using chunking and vector embedding.',
  inputSchema: z.object({
    projectId: z
      .string()
      .describe('Project ID to associate the wiki with'),
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
    projectId: z.string(),
    documentsProcessed: z.number().int(),
    chunksCreated: z.number().int(),
    success: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async (input: { context: Record<string, unknown> } | Record<string, unknown>) => {
    const ctx = (input?.context ?? input) as Record<string, unknown>;
    const projectId = ctx.projectId as string;
    const repositoryUrl = ctx.repositoryUrl as string;
    const branch = ctx.branch as string | undefined;

    try {
      return await generateWiki(projectId, repositoryUrl, branch);
    } catch (error: unknown) {
      console.error('[wiki-generate] Error:', error instanceof Error ? error.message : 'Unknown');
      return { projectId, documentsProcessed: 0, chunksCreated: 0, success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },
});
