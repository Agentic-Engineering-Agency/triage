import { z } from 'zod';

// ---------------------------------------------------------------------------
// Review severity — mirrors CodeRabbit's 5-level system
// ---------------------------------------------------------------------------

/** Issue severity from Critical (must fix) to Info (informational) */
export const reviewSeveritySchema = z
  .enum(['critical', 'major', 'minor', 'trivial', 'info'])
  .describe(
    'Issue severity: critical=system failure/security/data-loss, major=significant impact, ' +
    'minor=should fix but not urgent, trivial=low-impact quality, info=informational only'
  );

export type ReviewSeverity = z.infer<typeof reviewSeveritySchema>;

// ---------------------------------------------------------------------------
// Review category — what kind of issue was found
// ---------------------------------------------------------------------------

/** Category of the identified issue */
export const reviewCategorySchema = z
  .enum([
    'bug-risk',
    'security',
    'performance',
    'error-handling',
    'logic',
    'edge-case',
    'race-condition',
    'data-integrity',
    'maintainability',
    'complexity',
    'naming',
    'documentation',
    'style',
    'best-practice',
  ])
  .describe('Category of the issue found during review');

export type ReviewCategory = z.infer<typeof reviewCategorySchema>;

// ---------------------------------------------------------------------------
// Individual review comment — one issue found
// ---------------------------------------------------------------------------

/** A single review comment on a specific location in the code */
export const reviewCommentSchema = z.object({
  /** File path relative to repo root */
  filePath: z.string().describe('File path where the issue was found (e.g., src/auth/login.ts)'),

  /** Line number or range (e.g., "42" or "42-58") */
  lineRange: z.string().optional().describe('Line number or range, e.g., "42" or "42-58"'),

  /** Severity of this specific issue */
  severity: reviewSeveritySchema,

  /** Category of the issue */
  category: reviewCategorySchema,

  /** Concise title for the issue (one line) */
  title: z.string().max(120).describe('One-line issue title, e.g., "Unhandled null return from database query"'),

  /** Detailed explanation — what's wrong and WHY it matters */
  analysis: z.string().describe(
    'Detailed explanation of the issue: what is wrong, why it matters, ' +
    'what could go wrong in production. Target the code, not the person.'
  ),

  /** Concrete suggested fix — either a code snippet or actionable instruction */
  suggestion: z.string().describe(
    'Specific, actionable fix suggestion. Include a code snippet when possible. ' +
    'Good: "Add a null check: `if (!user) return res.status(404)`". ' +
    'Bad: "Handle this better."'
  ),

  /** Confidence that this is a real issue (not a false positive) */
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence this is a real issue (0.0=uncertain, 1.0=certain). Be honest about uncertainty.'),
});

export type ReviewComment = z.infer<typeof reviewCommentSchema>;

// ---------------------------------------------------------------------------
// File-level summary — triage decision per file
// ---------------------------------------------------------------------------

/** File-level review triage */
export const fileReviewSummarySchema = z.object({
  /** File path */
  filePath: z.string(),

  /** Triage decision: does this file need human review? */
  verdict: z
    .enum(['needs-review', 'approved', 'skipped'])
    .describe('needs-review=has issues or logic changes, approved=trivial/safe, skipped=non-code file'),

  /** One-line summary of what changed in this file */
  changeSummary: z.string().max(200).describe('One-line description of what changed in this file'),

  /** Number of issues found */
  issueCount: z.number().int().min(0),
});

export type FileReviewSummary = z.infer<typeof fileReviewSummarySchema>;

// ---------------------------------------------------------------------------
// Complete review output — the full structured review
// ---------------------------------------------------------------------------

/** Complete code review output for a changeset (PR, commit, or diff) */
export const codeReviewOutputSchema = z.object({
  /** High-level summary of the entire changeset (2-3 sentences) */
  summary: z.string().describe(
    'Executive summary of the changeset: what it does, what it changes, ' +
    'and the overall risk level. 2-3 sentences max.'
  ),

  /** Review effort estimate: 1=trivial, 5=very complex */
  reviewEffort: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe('Estimated review effort: 1=trivial rename, 5=complex multi-system change'),

  /** Overall verdict */
  verdict: z
    .enum(['approve', 'request-changes', 'comment-only'])
    .describe(
      'approve=safe to merge, request-changes=must fix before merge, ' +
      'comment-only=suggestions but not blocking'
    ),

  /** Per-file summaries with triage decisions */
  fileSummaries: z.array(fileReviewSummarySchema).describe('Per-file triage: needs-review, approved, or skipped'),

  /** Individual review comments — the detailed findings */
  comments: z.array(reviewCommentSchema).describe('Detailed review comments on specific code locations'),

  /** Aggregate stats */
  stats: z.object({
    filesReviewed: z.number().int().min(0),
    totalIssues: z.number().int().min(0),
    critical: z.number().int().min(0),
    major: z.number().int().min(0),
    minor: z.number().int().min(0),
    trivial: z.number().int().min(0),
    info: z.number().int().min(0),
  }).describe('Aggregate counts by severity'),

  /** Top risks — the most important things for the human reviewer to focus on */
  topRisks: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe('Top 1-5 risks a human reviewer should focus on, ordered by importance'),
});

export type CodeReviewOutput = z.infer<typeof codeReviewOutputSchema>;

// ---------------------------------------------------------------------------
// Review input — what to review
// ---------------------------------------------------------------------------

/** Input to the code review agent */
export const codeReviewInputSchema = z.object({
  /** The diff or changeset to review (unified diff format preferred) */
  diff: z.string().describe('Code diff to review — unified diff format, git diff output, or raw code'),

  /** Optional context about what this change is supposed to do */
  prTitle: z.string().optional().describe('PR or commit title — what the change is intended to do'),

  /** Optional PR description with more context */
  prDescription: z.string().optional().describe('PR description or commit message with context'),

  /** Language hint for better analysis */
  language: z.string().optional().describe('Primary language (e.g., "typescript", "ruby", "python")'),

  /** File paths to focus on (skip others) */
  focusFiles: z.array(z.string()).optional().describe('If provided, only review these files'),

  /** Review profile: chill = fewer comments, assertive = comprehensive */
  profile: z
    .enum(['chill', 'assertive'])
    .optional()
    .default('chill')
    .describe('chill=high-signal only (bugs, security), assertive=comprehensive (includes style, naming)'),
});

export type CodeReviewInput = z.infer<typeof codeReviewInputSchema>;
