import { z } from 'zod';

// Priority: 0 (No priority) through 4 (Low)
export const prioritySchema = z.number().int().min(0).max(4);

// Create a new Linear ticket
export const ticketCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  teamId: z.string().uuid(),
  priority: prioritySchema,
  assigneeId: z.string().uuid().optional(),
  labelIds: z.array(z.string().uuid()).optional(),
  stateId: z.string().uuid().optional(),
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

// Update an existing ticket
export const ticketUpdateSchema = z.object({
  issueId: z.string().min(1),
  title: z.string().max(500).optional(),
  description: z.string().max(50000).optional(),
  priority: prioritySchema.optional(),
  assigneeId: z.string().uuid().optional(),
  stateId: z.string().uuid().optional(),
  labelIds: z.array(z.string().uuid()).optional(),
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

// Search query parameters
export const issueSearchSchema = z.object({
  query: z.string().min(1).max(1000).optional(),
  teamId: z.string().uuid().optional(),
  status: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
  labels: z.array(z.string()).optional(),
  priority: z.number().optional(),
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
          }),
          priority: z.number(),
          url: z.string().url(),
        })
      ),
      totalCount: z.number(),
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

// Input schema for fetching team members by team ID
export const teamIdInputSchema = z.object({ teamId: z.string().min(1) });

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
