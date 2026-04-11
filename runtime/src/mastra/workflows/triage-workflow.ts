import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { triageAgent } from '../agents/triage-agent';
import { resolutionReviewer } from '../agents/resolution-reviewer';
import { codeReviewAgent } from '../agents/code-review-agent';
import { slackNotificationAgent } from '../agents/slack-notification-agent';
import {
  createLinearIssue,
  updateLinearIssue,
  getLinearIssue,
  searchLinearIssues,
  sendTicketNotification,
  sendResolutionNotification,
  commentOnGitHubPRTool,
} from '../tools/index';
import { sendSlackTicketNotification, sendSlackResolutionNotification } from '../tools/slack';
import { LINEAR_CONSTANTS, config } from '../../lib/config';
import { resolveStateId, resolveLabelId } from '../tools/linear-state-resolver';

// Helper to call tool.execute safely
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
    // Image processing is handled by the orchestrator agent via chat.
    // This step passes the description through as-is.
    const enrichedDescription = inputData.description;

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
    // 1. Query wiki RAG for relevant code context
    let wikiResults: Awaited<ReturnType<typeof queryWiki>> | null = null;
    try {
      wikiResults = await queryWiki(inputData.enrichedDescription);
      console.log(`[triage] Wiki RAG returned ${wikiResults.totalResults} results`);
    } catch (err) {
      console.error('[triage] Wiki RAG query failed, continuing with heuristic triage:', err instanceof Error ? err.message : err);
    }

    // 2. Determine severity from description keywords (heuristic)
    const desc = inputData.enrichedDescription.toLowerCase();
    let severity: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
    if (desc.includes('critical') || desc.includes('outage') || desc.includes('down') || desc.includes('p0')) {
      severity = 'P0';
    } else if (desc.includes('high') || desc.includes('major') || desc.includes('broken') || desc.includes('p1')) {
      severity = 'P1';
    } else if (desc.includes('medium') || desc.includes('degraded') || desc.includes('slow') || desc.includes('p2')) {
      severity = 'P2';
    } else if (desc.includes('low') || desc.includes('minor') || desc.includes('cosmetic') || desc.includes('p3')) {
      severity = 'P3';
    } else {
      severity = 'P2'; // default to medium
    }

    // 3. Extract file references and root cause context from wiki results
    const suggestedFiles = wikiResults
      ? [...new Set(wikiResults.results.map((r) => r.filePath).filter(Boolean))].slice(0, 10)
      : [];

    const rootCause = wikiResults && wikiResults.results.length > 0
      ? `Based on codebase analysis: ${wikiResults.results[0].content.slice(0, 500)}`
      : `Incident reported: ${inputData.enrichedDescription.slice(0, 300)}`;

    // 4. Build triage summary from wiki context
    const contextSnippets = wikiResults
      ? wikiResults.results.slice(0, 3).map((r) => `- **${r.filePath}** (score: ${r.score.toFixed(2)}): ${r.content.slice(0, 200)}`).join('\n')
      : 'No codebase context available.';

    const triageSummary = [
      `## Incident Triage`,
      `**Severity:** ${severity}`,
      `**Description:** ${inputData.enrichedDescription.slice(0, 500)}`,
      ``,
      `### Root Cause Analysis`,
      rootCause,
      ``,
      `### Relevant Code Context`,
      contextSnippets,
      ``,
      `### Suggested Files`,
      suggestedFiles.length > 0 ? suggestedFiles.map((f) => `- \`${f}\``).join('\n') : 'No specific files identified.',
    ].join('\n');

    return {
      severity,
      rootCause,
      suggestedFiles,
      triageSummary,
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
    let isDuplicate = false;
    let existingIssueId: string | undefined;
    let existingIssueUrl: string | undefined;
    let confidence = 0;

    try {
      // Extract keywords from the triage summary for search
      const searchQuery = inputData.enrichedDescription.slice(0, 200);

      const searchResult = await searchLinearIssues.execute({
        context: {
          query: searchQuery,
          teamId: LINEAR_CONSTANTS.TEAM_ID,
          limit: 5,
        },
      });

      if (searchResult && typeof searchResult === 'object' && 'success' in searchResult && searchResult.success) {
        const data = (searchResult as { success: true; data: { issues: Array<{ id: string; identifier: string; title: string; url: string }> } }).data;
        if (data?.issues?.length > 0) {
          // Simple title-keyword matching for dedup
          const descWords = new Set(inputData.enrichedDescription.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
          for (const issue of data.issues) {
            const titleWords = issue.title.toLowerCase().split(/\s+/);
            const matchCount = titleWords.filter((w) => descWords.has(w)).length;
            const matchRatio = titleWords.length > 0 ? matchCount / titleWords.length : 0;
            if (matchRatio > confidence) {
              confidence = matchRatio;
              existingIssueId = issue.id;
              existingIssueUrl = issue.url;
            }
          }
          if (confidence >= 0.6) {
            isDuplicate = true;
            console.log(`[dedup] Duplicate detected: ${existingIssueId} (confidence: ${confidence.toFixed(2)})`);
          }
        }
      }
    } catch (err) {
      console.error('[dedup] Linear search failed, continuing as non-duplicate:', err instanceof Error ? err.message : err);
    }

    return {
      isDuplicate,
      existingIssueId,
      existingIssueUrl,
      confidence,
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
      const severityToLabelName: Record<string, string> = {
        P0: 'CRITICAL',
        P1: 'HIGH',
        P2: 'MEDIUM',
        P3: 'LOW',
        P4: 'LOW',
      };

      if (inputData.isDuplicate && inputData.existingIssueId) {
        await callTool(updateLinearIssue, {
          issueId: inputData.existingIssueId,
          description: `[Updated] Additional context:\n${inputData.triageSummary}`,
        });
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

      // Resolve state and label IDs dynamically
      const triageStateId = await resolveStateId('TRIAGE', config.LINEAR_API_KEY);
      const severityLabelId = await resolveLabelId(severityToLabelName[inputData.severity], config.LINEAR_API_KEY);
      const bugLabelId = await resolveLabelId('BUG', config.LINEAR_API_KEY);

      const createResult = await callTool(createLinearIssue, {
        title: inputData.triageSummary.slice(0, 120),
        description: `## Root Cause\n${inputData.rootCause}\n\n## Details\n${inputData.enrichedDescription}\n\n## Suggested Files\n${inputData.suggestedFiles.join('\n')}\n\n---\n*Reporter: ${inputData.reporterEmail}*`,
        teamId: LINEAR_CONSTANTS.TEAM_ID,
        priority: severityToPriority[inputData.severity] ?? 3,
        stateId: triageStateId,
        labelIds: [severityLabelId, bugLabelId].filter(Boolean),
      });

      const created = createResult && typeof createResult === 'object' && 'data' in createResult
        ? (createResult as Record<string, unknown>).data as { id?: string; url?: string } | undefined
        : undefined;

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
        issueId: created?.id ?? inputData.existingIssueId,
        issueUrl: created?.url ?? inputData.existingIssueUrl ?? '',
        wasUpdated: false,
        severity: inputData.severity,
        rootCause: inputData.rootCause,
        triageSummary: inputData.triageSummary,
        reporterEmail: inputData.reporterEmail,
        assigneeEmail,
        assigneeName,
      };
    } catch (err) {
      console.error('[ticket] Linear operation failed:', err instanceof Error ? err.message : err);
      // Fallback: return placeholder so workflow can continue (graceful degradation)
      const fallbackId = `local-${Date.now()}`;
      return {
        issueId: fallbackId,
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
    // Map P0-P4 to notification severity labels
    const severityMap: Record<string, 'Critical' | 'High' | 'Medium' | 'Low'> = {
      P0: 'Critical', P1: 'High', P2: 'Medium', P3: 'Low', P4: 'Low',
    };
    const severity = severityMap[inputData.severity] ?? 'Medium';

    // Map P0-P4 to numeric priority
    const priorityMap: Record<string, number> = { P0: 1, P1: 1, P2: 2, P3: 3, P4: 4 };
    const priority = priorityMap[inputData.severity] ?? 3;

    let emailSent = false;
    let slackSent = false;

    // Send email notification via Resend
    try {
      const notifyEmail = inputData.assigneeEmail ?? inputData.reporterEmail;
      const notifyName = inputData.assigneeName ?? 'Team';

      await callTool(sendTicketNotification, {
        to: notifyEmail,
        ticketTitle: inputData.triageSummary.slice(0, 120),
        severity,
        priority,
        summary: inputData.triageSummary,
        linearUrl: inputData.issueUrl,
        assigneeName: notifyName,
        linearIssueId: inputData.issueId,
      });
      emailSent = true;
      console.log(`[notify] Email notification sent to ${notifyEmail}`);
    } catch (err) {
      console.error('[notify] Email notification failed:', err instanceof Error ? err.message : err);
    }

    // Send Slack notification via agent
    try {
      const ticketData = {
        ticketTitle: inputData.triageSummary.slice(0, 120),
        severity,
        summary: inputData.triageSummary,
        linearUrl: inputData.issueUrl,
        assigneeName: inputData.assigneeName ?? 'On-Call Engineer',
        linearIssueId: inputData.issueId,
      };
      await slackNotificationAgent.generate(
        `Format and send this ticket notification to Slack: ${JSON.stringify(ticketData)}`
      );
      slackSent = true;
      console.log('[notify] Slack notification sent via agent');
    } catch (slackErr) {
      console.error('[notify] Slack notification failed (non-blocking):', slackErr instanceof Error ? slackErr.message : slackErr);
    }

    return {
      notificationSent: emailSent || slackSent,
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
 * Checks the webhook payload status to determine if the fix was deployed
 * and produces a verification verdict.
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
    const { webhookPayload } = inputData;
    const newStatus = webhookPayload.newStatus.toLowerCase();

    // Determine verdict based on the Linear status change
    let verdict: 'resolved' | 'partially_resolved' | 'unresolved';
    let verificationNotes: string;

    try {
      // 1. Fetch issue details for context
      const issueResult = await callTool(getLinearIssue, { issueId: inputData.issueId });
      const issueData = issueResult && typeof issueResult === 'object' && 'data' in issueResult
        ? (issueResult as Record<string, unknown>).data as Record<string, unknown> | undefined
        : undefined;
      const description = String(issueData?.description ?? '');

      // 2. Check for PR links in the issue description
      const prUrlMatch = description.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/);

      if (!prUrlMatch) {
        // No PR found — use resolution-reviewer for verdict
        const resolutionResult = await resolutionReviewer.generate(
          `The Linear issue was moved to "${inputData.webhookPayload.newStatus}".\n` +
          `Original root cause: ${inputData.rootCause}\n` +
          `Issue description:\n${description.slice(0, 2000)}\n\n` +
          `Based on the status change, provide a resolution summary.`
        );

        return {
          verdict: 'resolved' as const,
          verificationNotes: resolutionResult.text?.slice(0, 1000) ?? `Issue marked as ${inputData.webhookPayload.newStatus}.`,
          issueId: inputData.issueId,
          issueUrl: inputData.issueUrl,
          severity: inputData.severity,
          reporterEmail: inputData.reporterEmail,
        };
      }

      // 3. Run resolution-reviewer and code-review-agent in parallel
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
        await callTool(commentOnGitHubPRTool, {
          prUrl,
          body: `## Automated Code Review\n\n${codeReviewResult.text}\n\n---\n*Review by Triage SRE Agent*`,
        });
        const inReviewStateId = await resolveStateId('IN_REVIEW', config.LINEAR_API_KEY);
        if (inReviewStateId) {
          await callTool(updateLinearIssue, {
            issueId: inputData.issueId,
            stateId: inReviewStateId,
          });
        }
        return {
          verdict: 'partially_resolved' as const,
          verificationNotes: `Code review found issues. PR: ${prUrl}. ${resolutionResult.text?.slice(0, 500) ?? ''}`,
          issueId: inputData.issueId,
          issueUrl: inputData.issueUrl,
          severity: inputData.severity,
          reporterEmail: inputData.reporterEmail,
        };
      }

      verdict = 'resolved';
      verificationNotes = `Fix verified. ${resolutionResult.text?.slice(0, 500) ?? ''}`;
    } catch (error) {
      console.error('[verify] Error:', error);
      verdict = 'partially_resolved';
      verificationNotes = `Verification encountered an error: ${error instanceof Error ? error.message : String(error)}`;
    }

    console.log(`[verify] Verdict: ${verdict} (status: ${webhookPayload.newStatus})`);

    return {
      verdict,
      verificationNotes,
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
    const resolutionSummary = `${inputData.verificationNotes}\n\nVerdict: ${inputData.verdict}`;
    const ticketTitle = `[${inputData.severity}] Incident — ${inputData.issueId}`;

    let emailSent = false;
    let slackSent = false;

    // Send resolution email via Resend
    try {
      await sendResolutionNotification.execute({
        context: {
          to: inputData.reporterEmail,
          originalTitle: ticketTitle,
          resolutionSummary,
          linearUrl: inputData.issueUrl,
          linearIssueId: inputData.issueId,
        },
      });
      emailSent = true;
      console.log(`[notify-resolution] Resolution email sent to ${inputData.reporterEmail}`);
    } catch (err) {
      console.error('[notify-resolution] Email notification failed:', err instanceof Error ? err.message : err);
    }

    // Send resolution Slack notification via agent
    try {
      const resolutionData = {
        ticketTitle: `Issue ${inputData.issueId}`,
        severity: 'Resolved',
        summary: `Resolution: ${resolutionSummary}\n\nVerdict: ${inputData.verdict}`,
        linearUrl: inputData.issueUrl,
        assigneeName: 'Triage SRE',
        linearIssueId: inputData.issueId,
      };
      await slackNotificationAgent.generate(
        `Format and send this resolution notification to Slack: ${JSON.stringify(resolutionData)}`
      );
      slackSent = true;
      console.log('[notify-resolution] Slack notification sent via agent');
    } catch (err) {
      console.error('[notify-resolution] Slack failed (non-blocking):', err instanceof Error ? err.message : err);
    }

    return {
      notificationSent: emailSent || slackSent,
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
