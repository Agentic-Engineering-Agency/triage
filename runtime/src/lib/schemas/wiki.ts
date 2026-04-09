import { z } from 'zod';

/**
 * Schema for a wiki document ingested from the codebase.
 * Documents are processed in two passes: structural (pass 1) and semantic (pass 2).
 */
export const wikiDocumentSchema = z.object({
  /** Unique identifier for the document */
  id: z.string().describe('Unique identifier for the wiki document'),
  /** Project this document belongs to */
  projectId: z.string().describe('Project identifier this document belongs to'),
  /** Path to the source file in the repository */
  filePath: z.string().describe('Path to the source file in the repository'),
  /** AI-generated summary of the document contents */
  summary: z.string().describe('AI-generated summary of the document contents'),
  /** Ingestion pass number: 1 = structural analysis, 2 = semantic enrichment */
  pass: z
    .union([z.literal(1), z.literal(2)])
    .describe('Ingestion pass: 1 = structural analysis, 2 = semantic enrichment'),
});

/** Inferred TypeScript type for WikiDocument */
export type WikiDocument = z.infer<typeof wikiDocumentSchema>;

/**
 * Schema for a chunk of a wiki document.
 * Documents are split into chunks for vector embedding and retrieval.
 */
export const wikiChunkSchema = z.object({
  /** Unique identifier for this chunk */
  id: z.string().describe('Unique identifier for this chunk'),
  /** ID of the parent document this chunk belongs to */
  documentId: z.string().describe('ID of the parent document this chunk belongs to'),
  /** Text content of the chunk */
  content: z.string().describe('Text content of the chunk'),
  /** Zero-based index of this chunk within the parent document */
  chunkIndex: z
    .number()
    .int()
    .min(0)
    .describe('Zero-based index of this chunk within the parent document'),
});

/** Inferred TypeScript type for WikiChunk */
export type WikiChunk = z.infer<typeof wikiChunkSchema>;

/**
 * Schema for a single chunk result returned from a wiki query.
 */
export const wikiQueryChunkSchema = z.object({
  /** Text content of the matching chunk */
  content: z.string().describe('Text content of the matching chunk'),
  /** Source file path the chunk originates from */
  filePath: z.string().describe('Source file path the chunk originates from'),
  /** Relevance score from vector similarity search (0 = no match, 1 = exact match) */
  relevance: z
    .number()
    .min(0)
    .max(1)
    .describe('Relevance score from vector similarity, 0.0 to 1.0'),
});

/** Inferred TypeScript type for WikiQueryChunk */
export type WikiQueryChunk = z.infer<typeof wikiQueryChunkSchema>;

/**
 * Schema for the result of a wiki knowledge base query.
 * Contains matching chunks and an AI-generated summary of the findings.
 */
export const wikiQueryResultSchema = z.object({
  /** Matching chunks ordered by relevance */
  chunks: z
    .array(wikiQueryChunkSchema)
    .describe('Matching chunks ordered by relevance'),
  /** AI-generated summary synthesizing the query results */
  summary: z.string().describe('AI-generated summary synthesizing the query results'),
});

/** Inferred TypeScript type for WikiQueryResult */
export type WikiQueryResult = z.infer<typeof wikiQueryResultSchema>;
