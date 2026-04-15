import { z } from 'zod';

// ============================================================
// Core schemas for Linear API integration (from Koki's PR#4)
// ============================================================

// Priority: 0 (No priority) through 4 (Low)
export const prioritySchema = z.number().int().min(0).max(4);

// Create a new Linear ticket.
// Note: IDs use z.string().optional() instead of .uuid().optional() because
// Mastra's tool-arg deserialization sometimes passes empty strings, which
// .uuid() rejects. The handler validates/falls-back as needed.
export const ticketCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  teamId: z.string().optional().describe('Linear team ID — defaults to configured team if omitted'),
  priority: prioritySchema,
  assigneeId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  stateId: z.string().optional(),
  cycleId: z.string().optional().describe('Linear cycle ID to assign the issue to'),
});

// Response from creating a ticket
export const ticketResponseSchema = z.object({
  success: z.boolean(),
  data: z
    .object({
      id: z.string(),
      identifier: z.string(),
      url: z.string().url(),
      title: z.string(),
    })
    .optional(),
  error: z.string().optional(),
});

// Update an existing ticket.
// IDs are z.string().optional() (not .uuid()) for Mastra arg-passing compatibility.
export const ticketUpdateSchema = z.object({
  issueId: z.string().min(1),
  title: z.string().max(500).optional(),
  description: z.string().max(50000).optional(),
  priority: prioritySchema.optional(),
  assigneeId: z.string().optional(),
  stateId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
});

// Full issue detail response
export const issueDetailSchema = z.object({
  success: z.boolean(),
  data: z
    .object({
      id: z.string(),
      identifier: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      state: z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
      }),
      assignee: z
        .object({
          id: z.string(),
          name: z.string(),
          email: z.string(),
        })
        .nullable(),
      labels: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
        })
      ),
      priority: z.number(),
      url: z.string().url(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .optional(),
  error: z.string().optional(),
});

// Search query parameters.
// IDs are z.string().optional() (not .uuid()) for Mastra arg-passing compatibility.
export const issueSearchSchema = z.object({
  query: z.string().min(1).max(1000).optional(),
  teamId: z.string().optional(),
  status: z.string().optional(),
  assigneeId: z.string().optional(),
  labels: z.array(z.string()).optional(),
  priority: prioritySchema.optional(),
  limit: z.number().min(1).max(50).default(10),
});

// Search result response
export const issueSearchResultSchema = z.object({
  success: z.boolean(),
  data: z
    .object({
      issues: z.array(
        z.object({
          id: z.string(),
          identifier: z.string(),
          title: z.string(),
          state: z.object({
            id: z.string(),
            name: z.string(),
          }).nullable(),
          priority: z.number(),
          url: z.string().url(),
        })
      ),
      returnedCount: z.number(),
      hasNextPage: z.boolean(),
    })
    .optional(),
  error: z.string().optional(),
});

// Team member
export const teamMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  displayName: z.string(),
});

// Team members response
export const teamMembersResponseSchema = z.object({
  success: z.boolean(),
  data: z
    .object({
      members: z.array(teamMemberSchema),
    })
    .optional(),
  error: z.string().optional(),
});

// Ticket notification (new ticket email)
export const ticketNotificationSchema = z.object({
  to: z.string().email(),
  ticketTitle: z.string(),
  severity: z.enum(['Critical', 'High', 'Medium', 'Low']),
  priority: prioritySchema,
  summary: z.string().max(10000),
  linearUrl: z.string().url(),
  assigneeName: z.string(),
  linearIssueId: z.string(),
});

// Resolution notification (resolved ticket email)
export const resolutionNotificationSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  originalTitle: z.string(),
  resolutionSummary: z.string().max(10000),
  prLink: z.string().url().optional(),
  linearUrl: z.string().url(),
  linearIssueId: z.string(),
});

// Input schema for fetching a single issue by ID
export const issueIdInputSchema = z.object({ issueId: z.string().min(1) });

// Input schema for fetching team members by team ID.
// teamId is optional and accepts empty string (Mastra sometimes sends "").
// The handler falls back to LINEAR_CONSTANTS.TEAM_ID when not provided.
export const teamIdInputSchema = z.object({
  teamId: z.string().optional().describe('Linear team ID — defaults to configured team if omitted'),
});

// Email send response
export const emailResponseSchema = z.object({
  success: z.boolean(),
  emailId: z.string().optional(),
  error: z.string().optional(),
});

// Generic tool success response
export const toolSuccessSchema = z.object({
  success: z.literal(true),
  data: z.record(z.unknown()).optional(),
});

// Generic tool error response
export const toolErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

// ============================================================
// Duplicate detection schemas (from Lalo's runtime scaffold)
// ============================================================

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
