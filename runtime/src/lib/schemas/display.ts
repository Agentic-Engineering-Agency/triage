import { z } from 'zod';

// ---------------------------------------------------------------------------
// Display triage input — props for the TriageCard UI component
// ---------------------------------------------------------------------------

/** Input for the display-triage tool (renders TriageCard in the frontend) */
export const displayTriageInputSchema = z.object({
  /** Current state of the triage card */
  state: z
    .enum(['loading', 'pending', 'confirmed', 'error'])
    .describe('Current state of the triage card: loading, pending, confirmed, or error'),

  /** Title of the triaged incident */
  title: z
    .string()
    .optional()
    .describe('Title of the triaged incident'),

  /** Severity classification of the incident */
  severity: z
    .enum(['Critical', 'High', 'Medium', 'Low'])
    .optional()
    .describe('Severity classification: Critical, High, Medium, or Low'),

  /** Confidence score for the triage classification */
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Confidence score for the triage classification (0.0 to 1.0)'),

  /** Brief summary of the triage analysis */
  summary: z
    .string()
    .optional()
    .describe('Brief summary of the triage analysis'),

  /** Source code file references related to the incident */
  fileReferences: z
    .array(
      z.object({
        /** Path to the referenced source file */
        filePath: z.string().describe('Path to the referenced source file'),

        /** Line number in the file where the issue was found */
        lineNumber: z
          .number()
          .optional()
          .describe('Line number in the file where the issue was found'),
      })
    )
    .optional()
    .describe('Source code file references related to the incident'),

  /** Proposed fix or remediation for the incident */
  proposedFix: z
    .string()
    .optional()
    .describe('Proposed fix or remediation for the incident'),

  /** URL of the created Linear ticket */
  linearUrl: z
    .string()
    .optional()
    .describe('URL of the created Linear ticket'),

  /** Error message to display when state is error */
  errorMessage: z
    .string()
    .optional()
    .describe('Error message to display when state is error'),
});

export type DisplayTriageInput = z.infer<typeof displayTriageInputSchema>;

// ---------------------------------------------------------------------------
// Display duplicate input — props for the DuplicatePrompt UI component
// ---------------------------------------------------------------------------

/** Input for the display-duplicate tool (renders DuplicatePrompt in the frontend) */
export const displayDuplicateInputSchema = z.object({
  /** Title of the existing ticket that may be a duplicate */
  existingTicketTitle: z
    .string()
    .optional()
    .describe('Title of the existing ticket that may be a duplicate'),

  /** URL of the existing ticket that may be a duplicate */
  existingTicketUrl: z
    .string()
    .optional()
    .describe('URL of the existing ticket that may be a duplicate'),

  /** Similarity score between the new incident and the existing ticket */
  similarity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Similarity score between the new incident and the existing ticket (0.0 to 1.0)'),
});

export type DisplayDuplicateInput = z.infer<typeof displayDuplicateInputSchema>;
