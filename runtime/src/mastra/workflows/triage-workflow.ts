import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const incidentReportSchema = z.object({
  /** Free-form incident description from the reporter */
  description: z.string().describe('Plain-text incident report'),
  /** Optional base-64 or URL references to screenshots / dashboards */
  images: z.array(z.string()).optional().describe('Optional screenshot URLs or base64 images'),
  /** Email of the person who filed the report */
  reporterEmail: z.string().email().describe('Reporter email address'),
  /** Optional repo context (org/repo) for RAG lookup */
  repository: z.string().optional().describe('GitHub org/repo for codebase wiki lookup'),
});

// ---------------------------------------------------------------------------
// Step 1 – Intake
// ---------------------------------------------------------------------------

/**
 * **intake** – Receive and validate the incoming incident report.
 *
 * Real implementation should:
 * - Validate the incident payload (description is non-empty, images are valid URLs/base64).
 * - If images are present, call a vision model (e.g. GPT-4o / Claude) to produce
 *   a textual description of each image and append it to the incident description.
 * - Normalise the combined text into a canonical "enriched description" for downstream steps.
 */
const intakeStep = createStep({
  id: 'intake',
  description: 'Receive and validate incident report. Describe images with vision model if present.',
  inputSchema: incidentReportSchema,
  outputSchema: z.object({
    enrichedDescription: z.string().describe('Combined text + image descriptions'),
    reporterEmail: z.string(),
    repository: z.string().optional(),
    hasImages: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    // TODO: If inputData.images exist, iterate and call a vision model to describe each image.
    //       Concatenate those descriptions with inputData.description to form enrichedDescription.
    //       For now, pass through the raw description.

    const enrichedDescription = inputData.description; // placeholder

    return {
      enrichedDescription,
      reporterEmail: inputData.reporterEmail,
      repository: inputData.repository,
      hasImages: (inputData.images?.length ?? 0) > 0,
    };
  },
});

// ---------------------------------------------------------------------------
// Step 2 – Triage
// ---------------------------------------------------------------------------

/**
 * **triage** – Analyse the incident against the codebase wiki (RAG).
 *
 * Real implementation should:
 * - Query the codebase-wiki vector store (RAG) with the enriched description.
 * - Use an LLM to classify severity (P0–P4), identify likely root cause,
 *   and suggest relevant source files / modules.
 * - Return structured triage output for ticket creation.
 */
const triageStep = createStep({
  id: 'triage',
  description: 'Analyse incident via codebase wiki RAG – classify severity, root cause, file refs.',
  inputSchema: z.object({
    enrichedDescription: z.string(),
    reporterEmail: z.string(),
    repository: z.string().optional(),
    hasImages: z.boolean(),
  }),
  outputSchema: z.object({
    severity: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']).describe('Incident severity'),
    rootCause: z.string().describe('Likely root cause summary'),
    suggestedFiles: z.array(z.string()).describe('Relevant source file paths'),
    triageSummary: z.string().describe('Structured triage summary for ticket body'),
    enrichedDescription: z.string(),
    reporterEmail: z.string(),
    repository: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    // TODO: 1. Query RAG vector store with inputData.enrichedDescription
    //       2. Feed retrieved context + description into LLM with triage prompt
    //       3. Parse structured output (severity, root cause, files)
    //       Return placeholder values for now.

    return {
      severity: 'P2' as const,
      rootCause: 'TODO: LLM-determined root cause',
      suggestedFiles: [],
      triageSummary: `Triage summary for: ${inputData.enrichedDescription.slice(0, 120)}…`,
      enrichedDescription: inputData.enrichedDescription,
      reporterEmail: inputData.reporterEmail,
      repository: inputData.repository,
    };
  },
});

// ---------------------------------------------------------------------------
// Step 3 – Dedup
// ---------------------------------------------------------------------------

/**
 * **dedup** – Check Linear for duplicate / similar existing tickets.
 *
 * Real implementation should:
 * - Search Linear issues (via API or MCP tool) using keywords from the triage summary.
 * - Use embedding similarity or fuzzy text matching to score duplicates.
 * - Return the best matching issue (if any) and a confidence score.
 */
const dedupStep = createStep({
  id: 'dedup',
  description: 'Check for duplicate/similar existing tickets in Linear.',
  inputSchema: z.object({
    severity: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
    rootCause: z.string(),
    suggestedFiles: z.array(z.string()),
    triageSummary: z.string(),
    enrichedDescription: z.string(),
    reporterEmail: z.string(),
    repository: z.string().optional(),
  }),
  outputSchema: z.object({
    isDuplicate: z.boolean(),
    existingIssueId: z.string().optional().describe('Linear issue ID if duplicate found'),
    existingIssueUrl: z.string().optional().describe('URL of the duplicate issue'),
    confidence: z.number().min(0).max(1).describe('Duplicate confidence score'),
    // Pass through triage data
    severity: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
    rootCause: z.string(),
    suggestedFiles: z.array(z.string()),
    triageSummary: z.string(),
    enrichedDescription: z.string(),
    reporterEmail: z.string(),
    repository: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    // TODO: 1. Call Linear API / MCP tool to search issues matching triageSummary keywords
    //       2. Compute similarity scores against existing open issues
    //       3. If confidence > threshold (e.g. 0.85), mark as duplicate
    //       Return no-duplicate placeholder for now.

    return {
      isDuplicate: false,
      existingIssueId: undefined,
      existingIssueUrl: undefined,
      confidence: 0,
      severity: inputData.severity,
      rootCause: inputData.rootCause,
      suggestedFiles: inputData.suggestedFiles,
      triageSummary: inputData.triageSummary,
      enrichedDescription: inputData.enrichedDescription,
      reporterEmail: inputData.reporterEmail,
      repository: inputData.repository,
    };
  },
});

// ---------------------------------------------------------------------------
// Step 4 – Ticket
// ---------------------------------------------------------------------------

/**
 * **ticket** – Create (or update) a Linear ticket with the structured triage output.
 *
 * Real implementation should:
 * - If dedup found a duplicate, add a comment to the existing issue with new context.
 * - Otherwise, create a new Linear issue with title, body (triage summary),
 *   severity label, file references, and assignee (on-call).
 * - Return the issue ID and URL for downstream steps.
 */
const ticketStep = createStep({
  id: 'ticket',
  description: 'Create Linear ticket with structured triage output (or update existing if duplicate).',
  inputSchema: z.object({
    isDuplicate: z.boolean(),
    existingIssueId: z.string().optional(),
    existingIssueUrl: z.string().optional(),
    confidence: z.number(),
    severity: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
    rootCause: z.string(),
    suggestedFiles: z.array(z.string()),
    triageSummary: z.string(),
    enrichedDescription: z.string(),
    reporterEmail: z.string(),
    repository: z.string().optional(),
  }),
  outputSchema: z.object({
    issueId: z.string().describe('Linear issue identifier'),
    issueUrl: z.string().describe('Linear issue URL'),
    wasUpdated: z.boolean().describe('True if an existing issue was updated instead of created'),
    severity: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
    rootCause: z.string(),
    triageSummary: z.string(),
    reporterEmail: z.string(),
  }),
  execute: async ({ inputData }) => {
    // TODO: 1. If inputData.isDuplicate && inputData.existingIssueId:
    //          - Call Linear API to add a comment with new triage context
    //          - Return the existing issue ID/URL
    //       2. Otherwise:
    //          - Call Linear API to create a new issue
    //          - Set title, description (triageSummary), priority from severity
    //          - Attach labels, file references, assign to on-call
    //       Return placeholder for now.

    return {
      issueId: inputData.existingIssueId ?? 'LINEAR-PLACEHOLDER-123',
      issueUrl: inputData.existingIssueUrl ?? 'https://linear.app/team/issue/PLACEHOLDER-123',
      wasUpdated: inputData.isDuplicate,
      severity: inputData.severity,
      rootCause: inputData.rootCause,
      triageSummary: inputData.triageSummary,
      reporterEmail: inputData.reporterEmail,
    };
  },
});

// ---------------------------------------------------------------------------
// Step 5 – Notify (ticket created)
// ---------------------------------------------------------------------------

/**
 * **notify** – Send email notification about the new/updated ticket.
 *
 * Real implementation should:
 * - Send an email to the reporter (and optionally on-call) with:
 *   - Ticket link, severity, root cause summary, suggested files
 * - Use Resend, SendGrid, or Mastra's built-in email integration.
 */
const notifyStep = createStep({
  id: 'notify',
  description: 'Send email notification to on-call/reporter about new ticket.',
  inputSchema: z.object({
    issueId: z.string(),
    issueUrl: z.string(),
    wasUpdated: z.boolean(),
    severity: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
    rootCause: z.string(),
    triageSummary: z.string(),
    reporterEmail: z.string(),
  }),
  outputSchema: z.object({
    notificationSent: z.boolean(),
    issueId: z.string(),
    issueUrl: z.string(),
    severity: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
    rootCause: z.string(),
    reporterEmail: z.string(),
  }),
  execute: async ({ inputData }) => {
    // TODO: 1. Compose email body with ticket link, severity, root cause, summary
    //       2. Send email to inputData.reporterEmail (and on-call address from config)
    //       3. Handle send failures gracefully (log, retry, or mark as failed)
    //       Return placeholder for now.

    console.log(
      `[notify] Would send email to ${inputData.reporterEmail} about ${inputData.issueUrl}`,
    );

    return {
      notificationSent: true,
      issueId: inputData.issueId,
      issueUrl: inputData.issueUrl,
      severity: inputData.severity,
      rootCause: inputData.rootCause,
      reporterEmail: inputData.reporterEmail,
    };
  },
});

// ---------------------------------------------------------------------------
// Step 6 – Suspend (wait for fix deployment webhook)
// ---------------------------------------------------------------------------

/**
 * **suspend** – Pause the workflow and wait for a webhook callback.
 *
 * The workflow suspends here until a Linear webhook fires indicating the
 * ticket status changed (e.g. "Done" / "Deployed"). An external webhook
 * handler calls `run.resume()` with the event payload to continue.
 *
 * Real implementation should:
 * - Suspend execution, persisting the workflow snapshot.
 * - On resume, the webhook handler provides the Linear event payload
 *   (issue ID, new status, optional deploy metadata).
 */
const suspendStep = createStep({
  id: 'suspend',
  description: 'Suspend workflow – wait for Linear webhook when fix is deployed.',
  inputSchema: z.object({
    issueId: z.string(),
    issueUrl: z.string(),
    severity: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
    rootCause: z.string(),
    reporterEmail: z.string(),
  }),
  outputSchema: z.object({
    issueId: z.string(),
    issueUrl: z.string(),
    severity: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
    rootCause: z.string(),
    reporterEmail: z.string(),
    webhookPayload: z.object({
      newStatus: z.string(),
      updatedAt: z.string(),
      deployUrl: z.string().optional(),
    }),
  }),
  resumeSchema: z.object({
    /** Payload from the Linear webhook indicating status change / deployment */
    newStatus: z.string().describe('New Linear issue status (e.g. "Done", "Deployed")'),
    updatedAt: z.string().describe('ISO timestamp of the status change'),
    deployUrl: z.string().optional().describe('URL of the deployment (if available)'),
  }),
  suspendSchema: z.object({
    reason: z.string(),
    issueId: z.string(),
    issueUrl: z.string(),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    // If we haven't received webhook data yet, suspend the workflow.
    if (!resumeData?.newStatus) {
      return await suspend({
        reason: 'Waiting for Linear webhook – fix deployment status change',
        issueId: inputData.issueId,
        issueUrl: inputData.issueUrl,
      });
    }

    // Resumed with webhook payload – pass data downstream.
    return {
      issueId: inputData.issueId,
      issueUrl: inputData.issueUrl,
      severity: inputData.severity,
      rootCause: inputData.rootCause,
      reporterEmail: inputData.reporterEmail,
      webhookPayload: {
        newStatus: resumeData.newStatus,
        updatedAt: resumeData.updatedAt,
        deployUrl: resumeData.deployUrl,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Step 7 – Verify
// ---------------------------------------------------------------------------

/**
 * **verify** – Run resolution verification after the fix is deployed.
 *
 * Real implementation should:
 * - Compare the deployed fix (PR diff, commit message) against the identified root cause.
 * - Optionally run automated checks (smoke tests, metric queries) to confirm resolution.
 * - Produce a verification verdict: resolved / partially resolved / unresolved.
 */
const verifyStep = createStep({
  id: 'verify',
  description: 'Resume on webhook – verify if fix addresses the root cause.',
  inputSchema: z.object({
    issueId: z.string(),
    issueUrl: z.string(),
    severity: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
    rootCause: z.string(),
    reporterEmail: z.string(),
    webhookPayload: z.object({
      newStatus: z.string(),
      updatedAt: z.string(),
      deployUrl: z.string().optional(),
    }),
  }),
  outputSchema: z.object({
    verdict: z.enum(['resolved', 'partially_resolved', 'unresolved']),
    verificationNotes: z.string().describe('Human-readable explanation of verification result'),
    issueId: z.string(),
    issueUrl: z.string(),
    severity: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
    reporterEmail: z.string(),
  }),
  execute: async ({ inputData }) => {
    // TODO: 1. Fetch PR / commit diff from deploy URL or Linear issue metadata
    //       2. Compare against inputData.rootCause using LLM analysis
    //       3. Optionally run automated smoke tests / metric queries
    //       4. Return verdict
    //       Return placeholder for now.

    return {
      verdict: 'resolved' as const,
      verificationNotes: `TODO: Verify fix for root cause: "${inputData.rootCause}"`,
      issueId: inputData.issueId,
      issueUrl: inputData.issueUrl,
      severity: inputData.severity,
      reporterEmail: inputData.reporterEmail,
    };
  },
});

// ---------------------------------------------------------------------------
// Step 8 – Notify Resolution
// ---------------------------------------------------------------------------

/**
 * **notify-resolution** – Send final email about the resolution status.
 *
 * Real implementation should:
 * - Send an email to the reporter (and on-call) with the verification verdict,
 *   notes, and a link to the ticket.
 * - If unresolved, include guidance on next steps or re-opening the ticket.
 */
const notifyResolutionStep = createStep({
  id: 'notify-resolution',
  description: 'Send final email notification about resolution status.',
  inputSchema: z.object({
    verdict: z.enum(['resolved', 'partially_resolved', 'unresolved']),
    verificationNotes: z.string(),
    issueId: z.string(),
    issueUrl: z.string(),
    severity: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
    reporterEmail: z.string(),
  }),
  outputSchema: z.object({
    notificationSent: z.boolean(),
    verdict: z.enum(['resolved', 'partially_resolved', 'unresolved']),
    issueId: z.string(),
    issueUrl: z.string(),
  }),
  execute: async ({ inputData }) => {
    // TODO: 1. Compose resolution email with verdict, notes, ticket link
    //       2. If verdict is "unresolved", include re-open instructions
    //       3. Send email to inputData.reporterEmail (and on-call)
    //       Return placeholder for now.

    console.log(
      `[notify-resolution] Would send resolution email to ${inputData.reporterEmail} – verdict: ${inputData.verdict}`,
    );

    return {
      notificationSent: true,
      verdict: inputData.verdict,
      issueId: inputData.issueId,
      issueUrl: inputData.issueUrl,
    };
  },
});

// ---------------------------------------------------------------------------
// Workflow – Triage E2E Pipeline
// ---------------------------------------------------------------------------

/**
 * **triageWorkflow** – Complete end-to-end incident triage pipeline.
 *
 * Flow:
 *   intake → triage → dedup → ticket → notify → suspend (webhook wait) → verify → notify-resolution
 *
 * The workflow suspends at the `suspend` step and waits for an external
 * webhook (Linear status change) to resume. A webhook handler should call
 * `run.resume({ step: 'suspend', resumeData: { newStatus, updatedAt, deployUrl } })`
 * to continue execution through verify → notify-resolution.
 */
export const triageWorkflow = createWorkflow({
  id: 'triage-workflow',
  inputSchema: incidentReportSchema,
  outputSchema: z.object({
    notificationSent: z.boolean(),
    verdict: z.enum(['resolved', 'partially_resolved', 'unresolved']),
    issueId: z.string(),
    issueUrl: z.string(),
  }),
})
  .then(intakeStep)
  .then(triageStep)
  .then(dedupStep)
  .then(ticketStep)
  .then(notifyStep)
  .then(suspendStep)
  .then(verifyStep)
  .then(notifyResolutionStep)
  .commit();
