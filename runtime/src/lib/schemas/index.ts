/**
 * Barrel export for all Triage SRE runtime schemas.
 *
 * Usage:
 *   import { triageOutputSchema, ticketCreateSchema, wikiDocumentSchema } from '@/lib/schemas';
 *   import type { TriageOutput, TicketCreate, WikiDocument } from '@/lib/schemas';
 */

// Triage schemas and types
export {
  severitySchema,
  prioritySchema,
  fileReferenceSchema,
  chainOfThoughtStatusSchema,
  chainOfThoughtStepSchema,
  triageOutputSchema,
} from './triage';

export type {
  Severity,
  Priority,
  FileReference,
  ChainOfThoughtStatus,
  ChainOfThoughtStep,
  TriageOutput,
} from './triage';

// Ticket schemas and types
export {
  prioritySchema as ticketPrioritySchema,
  ticketCreateSchema,
  ticketResponseSchema,
  ticketUpdateSchema,
  issueDetailSchema,
  issueSearchSchema,
  issueSearchResultSchema,
  teamMemberSchema,
  teamMembersResponseSchema,
  ticketNotificationSchema,
  resolutionNotificationSchema,
  issueIdInputSchema,
  teamIdInputSchema,
  emailResponseSchema,
  toolSuccessSchema,
  toolErrorSchema,
  duplicateRecommendationSchema,
  duplicateCheckSchema,
} from './ticket';

export type {
  DuplicateRecommendation,
  DuplicateCheck,
} from './ticket';

// Wiki schemas and types
export {
  wikiDocumentSchema,
  wikiChunkSchema,
  wikiQueryChunkSchema,
  wikiQueryResultSchema,
} from './wiki';

export type {
  WikiDocument,
  WikiChunk,
  WikiQueryChunk,
  WikiQueryResult,
} from './wiki';

// Code review schemas and types
export {
  reviewSeveritySchema,
  reviewCategorySchema,
  reviewCommentSchema,
  fileReviewSummarySchema,
  codeReviewOutputSchema,
  codeReviewInputSchema,
} from './review';

export type {
  ReviewSeverity,
  ReviewCategory,
  ReviewComment,
  FileReviewSummary,
  CodeReviewOutput,
  CodeReviewInput,
} from './review';

// Attachment schemas and types
export * from './attachments';

// Display schemas and types (TriageCard, DuplicatePrompt)
export * from './display';

// GitHub schemas and types
export * from './github';

// Integration schemas and types (BYO per-tenant keys)
export * from './integrations';
