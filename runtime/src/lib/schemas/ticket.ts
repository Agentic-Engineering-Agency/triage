import { z } from 'zod';

// Priority: 0 (No priority) through 4 (Low)
export const prioritySchema = z.number().min(0).max(4);

// Create a new Linear ticket
export const ticketCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  teamId: z.string().uuid(),
  priority: z.number().min(0).max(4),
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
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.number().min(0).max(4).optional(),
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
  query: z.string().optional(),
  teamId: z.string().optional(),
  status: z.string().optional(),
  assigneeId: z.string().optional(),
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
  priority: z.number(),
  summary: z.string(),
  linearUrl: z.string().url(),
  assigneeName: z.string(),
  linearIssueId: z.string(),
});

// Resolution notification (resolved ticket email)
export const resolutionNotificationSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  originalTitle: z.string(),
  resolutionSummary: z.string(),
  prLink: z.string().url().optional(),
  linearUrl: z.string().url(),
  linearIssueId: z.string(),
});

// Email send response
export const emailResponseSchema = z.object({
  success: z.boolean(),
  emailId: z.string().optional(),
  error: z.string().optional(),
});
