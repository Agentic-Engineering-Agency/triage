import { z } from 'zod';

// ---------------------------------------------------------------------------
// GitHub PR comment input — post a comment on a pull request
// ---------------------------------------------------------------------------

/** Input for the github-pr-comment tool */
export const githubPrCommentInputSchema = z.object({
  /** Full GitHub PR URL (e.g., https://github.com/org/repo/pull/123) */
  prUrl: z
    .string()
    .url()
    .describe('Full GitHub PR URL'),

  /** Markdown-formatted comment body to post on the PR */
  body: z
    .string()
    .describe('Markdown comment body'),
});

export type GithubPrCommentInput = z.infer<typeof githubPrCommentInputSchema>;

// ---------------------------------------------------------------------------
// GitHub PR comment output — result of posting a comment
// ---------------------------------------------------------------------------

/** Output from the github-pr-comment tool */
export const githubPrCommentOutputSchema = z.object({
  /** Whether the comment was posted successfully */
  success: z
    .boolean()
    .describe('Whether the comment was posted successfully'),

  /** URL of the created comment (present on success) */
  commentUrl: z
    .string()
    .optional()
    .describe('URL of the created comment (present on success)'),

  /** Error message if the comment failed to post */
  error: z
    .string()
    .optional()
    .describe('Error message if the comment failed to post'),
});

export type GithubPrCommentOutput = z.infer<typeof githubPrCommentOutputSchema>;
