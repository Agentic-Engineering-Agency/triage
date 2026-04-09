import { z } from 'zod';
import { severitySchema, prioritySchema } from './triage';

/**
 * Schema for creating a new triage ticket (e.g. in Linear).
 * Contains all fields needed to file an incident ticket from triage results.
 */
export const ticketCreateSchema = z.object({
  /** Title of the ticket, typically a concise incident summary */
  title: z.string().describe('Title of the ticket, typically a concise incident summary'),
  /** Detailed description including root cause, affected services, and context */
  description: z
    .string()
    .describe('Detailed description including root cause, affected services, and context'),
  /** Severity classification from the triage analysis */
  severity: severitySchema,
  /** Priority for task scheduling (maps to Linear priority 1-4) */
  priority: prioritySchema,
  /** Linear team key used when creating the ticket */
  teamKey: z
    .string()
    .describe('Linear team key used for ticket creation, e.g. "TRI"'),
  /** Optional Linear user ID to assign the ticket to */
  assigneeId: z
    .string()
    .optional()
    .describe('Optional Linear user ID to assign the ticket to'),
  /** Optional labels/tags to categorize the ticket */
  labels: z
    .array(z.string())
    .optional()
    .describe('Optional labels/tags to categorize the ticket'),
  /** Optional Linear project ID to file the ticket under */
  projectId: z
    .string()
    .optional()
    .describe('Optional Linear project ID to file the ticket under'),
});

/** Inferred TypeScript type for TicketCreate */
export type TicketCreate = z.infer<typeof ticketCreateSchema>;

/**
 * Schema for the response after successfully creating a ticket.
 * Contains the identifiers and URL needed to reference the created ticket.
 */
export const ticketResponseSchema = z.object({
  /** Internal unique ID of the created ticket */
  id: z.string().describe('Internal unique ID of the created ticket'),
  /** Human-readable ticket identifier, e.g. "TRI-42" */
  identifier: z
    .string()
    .describe('Human-readable ticket identifier, e.g. "TRI-42"'),
  /** Title of the created ticket */
  title: z.string().describe('Title of the created ticket'),
  /** URL to view the ticket in Linear */
  url: z.string().url().describe('URL to view the ticket in Linear'),
  /** Current workflow state of the ticket, e.g. "Triage", "In Progress" */
  state: z
    .string()
    .describe('Current workflow state of the ticket, e.g. "Triage", "In Progress"'),
});

/** Inferred TypeScript type for TicketResponse */
export type TicketResponse = z.infer<typeof ticketResponseSchema>;

/**
 * Recommendation action for duplicate ticket detection.
 */
export const duplicateRecommendationSchema = z
  .enum(['create_new', 'update_existing', 'skip'])
  .describe('Recommended action: create a new ticket, update existing, or skip');

/** Inferred TypeScript type for DuplicateRecommendation */
export type DuplicateRecommendation = z.infer<typeof duplicateRecommendationSchema>;

/**
 * Schema for the result of a duplicate ticket check.
 * Used to prevent filing duplicate incidents and to link related issues.
 */
export const duplicateCheckSchema = z.object({
  /** Whether a duplicate ticket was detected */
  isDuplicate: z.boolean().describe('Whether a duplicate ticket was detected'),
  /** Title of the existing duplicate ticket, if found */
  existingTicketTitle: z
    .string()
    .optional()
    .describe('Title of the existing duplicate ticket, if found'),
  /** URL of the existing duplicate ticket, if found */
  existingTicketUrl: z
    .string()
    .optional()
    .describe('URL of the existing duplicate ticket, if found'),
  /** Similarity score between the new and existing ticket (0 = unrelated, 1 = identical) */
  similarity: z
    .number()
    .min(0)
    .max(1)
    .describe('Similarity score, 0.0 (unrelated) to 1.0 (identical)'),
  /** Recommended action based on the duplicate analysis */
  recommendation: duplicateRecommendationSchema,
});

/** Inferred TypeScript type for DuplicateCheck */
export type DuplicateCheck = z.infer<typeof duplicateCheckSchema>;
