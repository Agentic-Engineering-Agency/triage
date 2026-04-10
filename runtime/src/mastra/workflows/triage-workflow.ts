import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { triageAgent } from '../agents/triage-agent';
import { resolutionReviewer } from '../agents/resolution-reviewer';
import { codeReviewAgent } from '../agents/code-review-agent';
import {
  createLinearIssue,
  updateLinearIssue,
  getLinearIssue,
  searchLinearIssues,
  sendTicketNotification,
  sendResolutionNotification,
  commentOnGitHubPRTool,
  queryWikiTool,
} from '../tools/index';
import { LINEAR_CONSTANTS } from '../../lib/config';

// Helper to call tool.execute safely
// Mastra tools accept (inputData, context) but the type signature varies.
// We use 'as any' to bypass strict typing — this is a workflow-internal helper.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(tool: { execute?: (...args: any[]) => Promise<any> }, input: Record<string, unknown>): Promise<any> {
  if (!tool.execute) return null;
  return tool.execute({ context: input }, {});
}

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
 * The orchestrator handles attachments BEFORE the workflow, so this step
 * simply validates and passes through.
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
    try {
      return {
        enrichedDescription: inputData.description,
        reporterEmail: inputData.reporterEmail,
        repository: inputData.repository,
        hasImages: (inputData.images?.length ?? 0) > 0,
      };
    } catch (error) {
      console.error('[intake] Error:', error);
      return {
        enrichedDescription: inputData.description,
        reporterEmail: inputData.reporterEmail,
        repository: inputData.repository,
        hasImages: false,
      };
    }
  },
});

// ---------------------------------------------------------------------------
// Step 2 – Triage
// ---------------------------------------------------------------------------

/**
 * **triage** – Analyse the incident against the codebase wiki (RAG).
 *
 * Queries the codebase-wiki vector store and uses an LLM to classify severity,
 * identify likely root cause, and suggest relevant source files.
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
    try {
      const wikiResult = await callTool(queryWikiTool, { query: inputData.enrichedDescription });
      const wikiContext = wikiResult && typeof wikiResult === 'object' && 'results' in wikiResult
        ? JSON.stringify((wikiResult as Record<string, unknown>).results)
        : '';

      const triageSchema = z.object({
        severity: z.enum(['Critical', 'High', 'Medium', 'Low']),
        rootCause: z.string(),
        suggestedFiles: z.array(z.string()),
        triageSummary: z.string(),
      });

      const result = await triageAgent.generate(
        `Analyze this incident and produce a structured triage assessment.

## Incident Report
${inputData.enrichedDescription}

## Codebase Context
${wikiContext}

Respond with a JSON object containing: severity (Critical/High/Medium/Low), rootCause, suggestedFiles (array of file paths), and triageSummary.`,
        { structuredOutput: { schema: triageSchema } }
      );

      const parsed = result.object ?? { severity: 'Medium' as const, rootCause: 'Unable to determine', suggestedFiles: [] as string[], triageSummary: inputData.enrichedDescription };
      const severityToP: Record<string, string> = { Critical: 'P0', High: 'P1', Medium: 'P2', Low: 'P3' };
      return {
        severity: (severityToP[parsed.severity] ?? 'P2') as 'P0'|'P1'|'P2'|'P3'|'P4',
        rootCause: parsed.rootCause,
        suggestedFiles: parsed.suggestedFiles,
        triageSummary: parsed.triageSummary,
        enrichedDescription: inputData.enrichedDescription,
        reporterEmail: inputData.reporterEmail,
        repository: inputData.repository,
      };
    } catch (error) {
      console.error('[triage] Error:', error);
      return {
        severity: 'P2' as const,
        rootCause: 'Unable to determine root cause (triage error)',
        suggestedFiles: [],
        triageSummary: `Triage summary for: ${inputData.enrichedDescription.slice(0, 120)}`,
        enrichedDescription: inputData.enrichedDescription,
        reporterEmail: inputData.reporterEmail,
        repository: inputData.repository,
      };
    }
  },
});

// ---------------------------------------------------------------------------
// Step 3 – Dedup
// ---------------------------------------------------------------------------

/**
 * **dedup** – Check Linear for duplicate / similar existing tickets.
 *
 * Searches Linear issues using keywords from the triage summary and uses
 * keyword overlap similarity to score duplicates.
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
    try {
      const searchResult = await callTool(searchLinearIssues, {
        query: inputData.triageSummary,
        teamId: LINEAR_CONSTANTS.TEAM_ID,
        limit: 5,
      });

      let bestMatch: { id: string; url: string; title: string; similarity: number } | null = null;

      if (searchResult && typeof searchResult === 'object' && 'success' in searchResult && (searchResult as Record<string, unknown>).success) {
        const data = (searchResult as Record<string, unknown>).data as { issues?: Array<{ id: string; url: string; title: string }> } | undefined;
        const issues = data?.issues ?? [];

        // Simple keyword overlap for similarity
        const newKeywords = new Set(inputData.triageSummary.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        for (const issue of issues) {
          const issueKeywords = new Set(issue.title.toLowerCase().split(/\s+/).filter(w => w.length > 3));
          const intersection = [...newKeywords].filter(k => issueKeywords.has(k));
          const union = new Set([...newKeywords, ...issueKeywords]);
          const similarity = union.size > 0 ? intersection.length / union.size : 0;
          if (!bestMatch || similarity > bestMatch.similarity) {
            bestMatch = { id: issue.id, url: issue.url, title: issue.title, similarity };
          }
        }
      }

      return {
        isDuplicate: bestMatch ? bestMatch.similarity > 0.85 : false,
        existingIssueId: bestMatch?.id,
        existingIssueUrl: bestMatch?.url,
        confidence: bestMatch?.similarity ?? 0,
        severity: inputData.severity,
        rootCause: inputData.rootCause,
        suggestedFiles: inputData.suggestedFiles,
        triageSummary: inputData.triageSummary,
        enrichedDescription: inputData.enrichedDescription,
        reporterEmail: inputData.reporterEmail,
        repository: inputData.repository,
      };
    } catch (error) {
      console.error('[dedup] Error:', error);
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
    }
  },
});

// ---------------------------------------------------------------------------
// Step 4 – Ticket
// ---------------------------------------------------------------------------

/**
 * **ticket** – Create (or update) a Linear ticket with the structured triage output.
 *
 * If dedup found a duplicate, updates the existing issue with new context.
 * Otherwise, creates a new Linear issue with severity labels and file references.
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
    assigneeEmail: z.string().optional().describe('Email of the Linear assignee, if assigned'),
    assigneeName: z.string().optional().describe('Display name of the Linear assignee'),
  }),
  execute: async ({ inputData }) => {
    try {
      const severityToPriority: Record<string, number> = { P0: 1, P1: 2, P2: 3, P3: 4, P4: 4 };
      const severityToLabel: Record<string, string> = {
        P0: LINEAR_CONSTANTS.SEVERITY_LABELS.CRITICAL,
        P1: LINEAR_CONSTANTS.SEVERITY_LABELS.HIGH,
        P2: LINEAR_CONSTANTS.SEVERITY_LABELS.MEDIUM,
        P3: LINEAR_CONSTANTS.SEVERITY_LABELS.LOW,
        P4: LINEAR_CONSTANTS.SEVERITY_LABELS.LOW,
      };

      if (inputData.isDuplicate && inputData.existingIssueId) {
        // Update existing issue with new context
        await callTool(updateLinearIssue, {
          issueId: inputData.existingIssueId,
          description: `[Updated] Additional context:\n${inputData.triageSummary}`,
        });
        // Fetch assignee from the existing issue
        const existing = await callTool(getLinearIssue, { issueId: inputData.existingIssueId }).catch(() => null);
        const existingAssignee = (existing as Record<string, unknown>)?.data as { assignee?: { email: string; name: string } | null } | undefined;
        return {
          issueId: inputData.existingIssueId,
          issueUrl: inputData.existingIssueUrl ?? '',
          wasUpdated: true,
          severity: inputData.severity,
          rootCause: inputData.rootCause,
          triageSummary: inputData.triageSummary,
          reporterEmail: inputData.reporterEmail,
          assigneeEmail: existingAssignee?.assignee?.email,
          assigneeName: existingAssignee?.assignee?.name,
        };
      }

      // Create new issue
      const createResult = await callTool(createLinearIssue, {
        title: inputData.triageSummary.slice(0, 120),
        description: `## Root Cause\n${inputData.rootCause}\n\n## Details\n${inputData.enrichedDescription}\n\n## Suggested Files\n${inputData.suggestedFiles.join('\n')}`,
        teamId: LINEAR_CONSTANTS.TEAM_ID,
        priority: severityToPriority[inputData.severity] ?? 3,
        stateId: LINEAR_CONSTANTS.STATES.TRIAGE,
        labelIds: [severityToLabel[inputData.severity], LINEAR_CONSTANTS.CATEGORY_LABELS.BUG].filter(Boolean),
      });

      const created = createResult && typeof createResult === 'object' && 'data' in createResult
        ? (createResult as Record<string, unknown>).data as { id?: string; url?: string } | undefined
        : undefined;

      // Fetch the created issue to get assignee details (Linear may auto-assign based on team settings)
      let assigneeEmail: string | undefined;
      let assigneeName: string | undefined;
      if (created?.id) {
        const issueDetails = await callTool(getLinearIssue, { issueId: created.id }).catch(() => null);
        const details = (issueDetails as Record<string, unknown>)?.data as { assignee?: { email: string; name: string } | null } | undefined;
        if (details?.assignee) {
          assigneeEmail = details.assignee.email;
          assigneeName = details.assignee.name;
        }
      }

      return {
        issueId: created?.id ?? 'unknown',
        issueUrl: created?.url ?? '',
        wasUpdated: false,
        severity: inputData.severity,
        rootCause: inputData.rootCause,
        triageSummary: inputData.triageSummary,
        reporterEmail: inputData.reporterEmail,
        assigneeEmail,
        assigneeName,
      };
    } catch (error) {
      console.error('[ticket] Error:', error);
      return {
        issueId: 'error',
        issueUrl: '',
        wasUpdated: false,
        severity: inputData.severity,
        rootCause: inputData.rootCause,
        triageSummary: inputData.triageSummary,
        reporterEmail: inputData.reporterEmail,
      };
    }
  },
});

// ---------------------------------------------------------------------------
// Step 5 – Notify (ticket created)
// ---------------------------------------------------------------------------

/**
 * **notify** – Send email notification about the new/updated ticket.
 *
 * Sends an email to the reporter with ticket link, severity, root cause summary.
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
    assigneeEmail: z.string().optional(),
    assigneeName: z.string().optional(),
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
    try {
      const severityMap: Record<string, 'Critical'|'High'|'Medium'|'Low'> = { P0: 'Critical', P1: 'High', P2: 'Medium', P3: 'Low', P4: 'Low' };
      // Send ticket notification to assignee if assigned, otherwise fall back to reporter
      const notifyEmail = inputData.assigneeEmail ?? inputData.reporterEmail;
      const notifyName = inputData.assigneeName ?? 'Team';
      await callTool(sendTicketNotification, {
        to: notifyEmail,
        ticketTitle: inputData.triageSummary.slice(0, 120),
        severity: severityMap[inputData.severity] ?? 'Medium',
        priority: ({ P0: 1, P1: 2, P2: 3, P3: 4, P4: 4 } as Record<string, number>)[inputData.severity] ?? 3,
        summary: inputData.triageSummary,
        linearUrl: inputData.issueUrl,
        assigneeName: notifyName,
        linearIssueId: inputData.issueId,
      });
      return {
        notificationSent: true,
        issueId: inputData.issueId,
        issueUrl: inputData.issueUrl,
        severity: inputData.severity,
        rootCause: inputData.rootCause,
        reporterEmail: inputData.reporterEmail,
      };
    } catch (error) {
      console.error('[notify] Error:', error);
      return {
        notificationSent: false,
        issueId: inputData.issueId,
        issueUrl: inputData.issueUrl,
        severity: inputData.severity,
        rootCause: inputData.rootCause,
        reporterEmail: inputData.reporterEmail,
      };
    }
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
 * Checks for PR attachments, runs resolution-reviewer and code-review-agent
 * in parallel, and produces a verification verdict.
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
    try {
      // 1. Get the Linear issue to check for PR attachments
      const issueResult = await callTool(getLinearIssue, { issueId: inputData.issueId });
      const issueData = issueResult && typeof issueResult === 'object' && 'data' in issueResult
        ? (issueResult as Record<string, unknown>).data as Record<string, unknown> | undefined
        : undefined;

      // Check for PR links in the issue description or attachments
      const description = String(issueData?.description ?? '');
      const prUrlMatch = description.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/);

      if (!prUrlMatch) {
        // No PR found — use resolution-reviewer to analyze issue context instead
        // (Full PR-based review path preserved below for when wiki + GitHub are connected)
        const issueTitle = String(issueData?.title ?? inputData.issueId);
        const issueState = (issueData?.state as { name?: string })?.name ?? 'Done';
        const resolutionResult = await resolutionReviewer.generate(
          `The Linear issue "${issueTitle}" was moved to "${issueState}".\n` +
          `Original root cause: ${inputData.rootCause}\n` +
          `Issue description:\n${description.slice(0, 2000)}\n\n` +
          `No pull request is linked yet. Based on the issue context and status change, ` +
          `provide a resolution summary: was the issue addressed? What should the reporter know?`
        );

        return {
          verdict: 'resolved' as const,
          verificationNotes: resolutionResult.text?.slice(0, 1000) ?? `Issue ${issueTitle} marked as ${issueState}. No PR linked — resolution confirmed via status change.`,
          issueId: inputData.issueId,
          issueUrl: inputData.issueUrl,
          severity: inputData.severity,
          reporterEmail: inputData.reporterEmail,
        };
      }

      // 2. Run resolution-reviewer and code-review-agent in parallel
      const prUrl = prUrlMatch[0];
      const [resolutionResult, codeReviewResult] = await Promise.all([
        resolutionReviewer.generate(
          `Verify if this fix resolves the incident.\nOriginal root cause: ${inputData.rootCause}\nPR: ${prUrl}\nIssue: ${inputData.issueUrl}`
        ),
        codeReviewAgent.generate(
          `Review the code changes in this PR for quality and correctness.\nPR: ${prUrl}\nContext: This PR should fix: ${inputData.rootCause}`
        ),
      ]);

      const hasIssues = codeReviewResult.text?.toLowerCase().includes('request-changes') ||
        codeReviewResult.text?.toLowerCase().includes('critical') ||
        codeReviewResult.text?.toLowerCase().includes('major');

      if (hasIssues) {
        // Post comments on the PR and move to IN_REVIEW
        await callTool(commentOnGitHubPRTool, {
          prUrl,
          body: `## Automated Code Review\n\n${codeReviewResult.text}\n\n---\n*Review by Triage SRE Agent*`,
        });
        await callTool(updateLinearIssue, {
          issueId: inputData.issueId,
          stateId: LINEAR_CONSTANTS.STATES.IN_REVIEW,
        });
        return {
          verdict: 'partially_resolved' as const,
          verificationNotes: `Code review found issues. PR: ${prUrl}. ${resolutionResult.text?.slice(0, 500) ?? ''}`,
          issueId: inputData.issueId,
          issueUrl: inputData.issueUrl,
          severity: inputData.severity,
          reporterEmail: inputData.reporterEmail,
        };
      }

      // 3. All good — mark as resolved
      return {
        verdict: 'resolved' as const,
        verificationNotes: `Fix verified. ${resolutionResult.text?.slice(0, 500) ?? ''}`,
        issueId: inputData.issueId,
        issueUrl: inputData.issueUrl,
        severity: inputData.severity,
        reporterEmail: inputData.reporterEmail,
      };
    } catch (error) {
      console.error('[verify] Error:', error);
      return {
        verdict: 'partially_resolved' as const,
        verificationNotes: `Verification encountered an error: ${error instanceof Error ? error.message : String(error)}`,
        issueId: inputData.issueId,
        issueUrl: inputData.issueUrl,
        severity: inputData.severity,
        reporterEmail: inputData.reporterEmail,
      };
    }
  },
});

// ---------------------------------------------------------------------------
// Step 8 – Notify Resolution
// ---------------------------------------------------------------------------

/**
 * **notify-resolution** – Send final email about the resolution status.
 *
 * Sends an email to the reporter with the verification verdict, notes,
 * and a link to the ticket.
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
    try {
      await callTool(sendResolutionNotification, {
        to: inputData.reporterEmail,
        originalTitle: `Issue ${inputData.issueId}`,
        resolutionSummary: `Verdict: ${inputData.verdict}. ${inputData.verificationNotes}`,
        linearUrl: inputData.issueUrl,
        linearIssueId: inputData.issueId,
      });
      return {
        notificationSent: true,
        verdict: inputData.verdict,
        issueId: inputData.issueId,
        issueUrl: inputData.issueUrl,
      };
    } catch (error) {
      console.error('[notify-resolution] Error:', error);
      return {
        notificationSent: false,
        verdict: inputData.verdict,
        issueId: inputData.issueId,
        issueUrl: inputData.issueUrl,
      };
    }
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
