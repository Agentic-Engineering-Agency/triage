import { z } from 'zod';

/**
 * Severity levels for triage incidents.
 * Maps to standard SRE severity classifications.
 */
export const severitySchema = z
  .enum(['Critical', 'High', 'Medium', 'Low'])
  .describe('Incident severity level from Critical (service down) to Low (minor issue)');

/** Inferred TypeScript type for Severity */
export type Severity = z.infer<typeof severitySchema>;

/**
 * Priority levels for ticket creation.
 * Maps directly to Linear priority values:
 *   Urgent = 1, High = 2, Medium = 3, Low = 4
 */
export const prioritySchema = z
  .enum(['Urgent', 'High', 'Medium', 'Low'])
  .describe('Ticket priority mapping to Linear values: Urgent=1, High=2, Medium=3, Low=4');

/** Inferred TypeScript type for Priority */
export type Priority = z.infer<typeof prioritySchema>;

/**
 * Schema for a file reference found during triage analysis.
 * Points to a specific file (and optionally a line range) relevant to the incident.
 */
export const fileReferenceSchema = z.object({
  /** Path to the relevant source file */
  filePath: z.string().describe('Path to the relevant source file'),
  /** Optional line range within the file, e.g. "42-58" */
  lineRange: z.string().optional().describe('Optional line range, e.g. "42-58"'),
  /** Why this file is relevant to the incident */
  relevance: z.string().describe('Explanation of why this file is relevant to the incident'),
});

/** Inferred TypeScript type for FileReference */
export type FileReference = z.infer<typeof fileReferenceSchema>;

/**
 * Status of a single step in the chain-of-thought reasoning process.
 */
export const chainOfThoughtStatusSchema = z
  .enum(['pending', 'running', 'complete', 'error'])
  .describe('Execution status of a chain-of-thought reasoning step');

/** Inferred TypeScript type for ChainOfThoughtStatus */
export type ChainOfThoughtStatus = z.infer<typeof chainOfThoughtStatusSchema>;

/**
 * A single step in the triage agent's chain-of-thought reasoning.
 * Used for transparency and streaming progress updates to the UI.
 */
export const chainOfThoughtStepSchema = z.object({
  /** Human-readable description of this reasoning step */
  step: z.string().describe('Human-readable description of the reasoning step'),
  /** The service being analyzed in this step */
  service: z.string().describe('The service being analyzed in this step'),
  /** Detailed reasoning or findings for this step */
  reasoning: z.string().describe('Detailed reasoning or findings for this step'),
  /** Current execution status of this step */
  status: chainOfThoughtStatusSchema,
});

/** Inferred TypeScript type for ChainOfThoughtStep */
export type ChainOfThoughtStep = z.infer<typeof chainOfThoughtStepSchema>;

/**
 * Complete triage output schema.
 * Represents the full structured result of an AI-driven incident triage analysis.
 */
export const triageOutputSchema = z.object({
  /** Assessed severity of the incident */
  severity: severitySchema,
  /** Confidence score of the triage assessment (0 = no confidence, 1 = fully confident) */
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence score of the triage assessment, 0.0 to 1.0'),
  /** Brief human-readable summary of the incident */
  summary: z.string().describe('Brief human-readable summary of the incident'),
  /** Identified root cause of the incident */
  rootCause: z.string().describe('Identified root cause of the incident'),
  /** List of service names affected by the incident */
  affectedServices: z
    .array(z.string())
    .describe('List of service names affected by the incident'),
  /** Source file references relevant to the incident */
  fileReferences: z
    .array(fileReferenceSchema)
    .describe('Source file references relevant to the incident'),
  /** Recommended actions to resolve or mitigate the incident */
  suggestedActions: z
    .array(z.string())
    .describe('Recommended actions to resolve or mitigate the incident'),
  /** Step-by-step reasoning chain showing how the triage conclusion was reached */
  chainOfThought: z
    .array(chainOfThoughtStepSchema)
    .describe('Step-by-step reasoning chain showing how the triage conclusion was reached'),
});

/** Inferred TypeScript type for the complete TriageOutput */
export type TriageOutput = z.infer<typeof triageOutputSchema>;
