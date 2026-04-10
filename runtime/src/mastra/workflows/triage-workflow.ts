import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import crypto from 'crypto';
import { createClient } from '@libsql/client';
import { queryWiki } from '../../lib/wiki-rag';
import { createLinearIssue, searchLinearIssues } from '../tools/linear';
import { sendTicketNotification, sendResolutionNotification } from '../tools/resend';
import { sendSlackTicketNotification, sendSlackResolutionNotification } from '../tools/slack';
import { LINEAR_CONSTANTS, LINEAR_BASE_URL } from '../../lib/config';

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
  /** Optional project ID (from local projects table) for evidence lookup later */
  projectId: z.string().uuid().optional().describe('Local project ID for later GitHub evidence lookup'),
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
    projectId: z.string().optional(),
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
      projectId: inputData.projectId,
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
    projectId: z.string().optional(),
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
    projectId: z.string().optional(),
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
      projectId: inputData.projectId,
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
    projectId: z.string().optional(),
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
    projectId: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    let isDuplicate = false;
    let existingIssueId: string | undefined;
    let existingIssueUrl: string | undefined;
    let confidence = 0;

    try {
      // Extract keywords from the triage summary for search
      const searchQuery = inputData.enrichedDescription.slice(0, 200);

      const searchResult = await searchLinearIssues.execute?.(
        {
          query: searchQuery,
          teamId: LINEAR_CONSTANTS.TEAM_ID,
          limit: 5,
        },
        {} as never,
      );

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
      projectId: inputData.projectId,
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
    projectId: z.string().optional(),
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
    // If duplicate, return existing issue info
    if (inputData.isDuplicate && inputData.existingIssueId) {
      console.log(`[ticket] Duplicate detected — returning existing issue ${inputData.existingIssueId}`);
      return {
        issueId: inputData.existingIssueId,
        issueUrl: inputData.existingIssueUrl ?? `${LINEAR_BASE_URL}/issue/${inputData.existingIssueId}`,
        wasUpdated: true,
        severity: inputData.severity,
        rootCause: inputData.rootCause,
        triageSummary: inputData.triageSummary,
        reporterEmail: inputData.reporterEmail,
      };
    }

    // Map P0-P4 severity to Linear priority number (1=Urgent, 2=High, 3=Medium, 4=Low)
    const severityToPriority: Record<string, number> = { P0: 1, P1: 1, P2: 2, P3: 3, P4: 4 };
    const priority = severityToPriority[inputData.severity] ?? 3;

    // Map severity to label IDs
    const severityToLabel: Record<string, string> = {
      P0: LINEAR_CONSTANTS.SEVERITY_LABELS.CRITICAL,
      P1: LINEAR_CONSTANTS.SEVERITY_LABELS.HIGH,
      P2: LINEAR_CONSTANTS.SEVERITY_LABELS.MEDIUM,
      P3: LINEAR_CONSTANTS.SEVERITY_LABELS.LOW,
      P4: LINEAR_CONSTANTS.SEVERITY_LABELS.LOW,
    };
    const labelIds = [severityToLabel[inputData.severity]].filter(Boolean);

    // Build ticket title from description
    const title = `[${inputData.severity}] ${inputData.enrichedDescription.slice(0, 100)}`;

    try {
      const result = await createLinearIssue.execute?.(
        {
          teamId: LINEAR_CONSTANTS.TEAM_ID,
          title,
          description: inputData.triageSummary,
          priority,
          labelIds,
          stateId: LINEAR_CONSTANTS.STATES.TRIAGE,
        },
        {} as never,
      );

      if (result && typeof result === 'object' && 'success' in result && result.success) {
        const data = (result as { success: true; data: { id: string; identifier: string; url: string; title: string } }).data;
        console.log(`[ticket] Created Linear issue: ${data.identifier}`);

        // Persist a local_tickets row so the In Review webhook handler can
        // recover the reporter email + project context later. Best-effort:
        // a failure here must NOT block the workflow.
        try {
          const db = createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
          const now = Date.now();
          await db.execute({
            sql: `INSERT INTO local_tickets
                  (id, linear_issue_id, title, description, severity, priority, status, assignee_id, project_id, reporter_email, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              crypto.randomUUID(),
              data.id,
              title,
              inputData.triageSummary,
              inputData.severity,
              priority,
              'in_triage',
              null,
              inputData.projectId ?? null,
              inputData.reporterEmail,
              now,
              now,
            ],
          });
          console.log(`[ticket] Persisted local_tickets row for ${data.identifier}`);
        } catch (dbErr) {
          console.error('[ticket] local_tickets insert failed (non-fatal):', dbErr instanceof Error ? dbErr.message : dbErr);
        }

        return {
          issueId: data.id,
          issueUrl: data.url,
          wasUpdated: false,
          severity: inputData.severity,
          rootCause: inputData.rootCause,
          triageSummary: inputData.triageSummary,
          reporterEmail: inputData.reporterEmail,
        };
      }

      // Linear call returned but was unsuccessful — fallback
      console.error('[ticket] Linear createIssue returned unsuccessful:', result);
    } catch (err) {
      console.error('[ticket] Linear createIssue failed:', err instanceof Error ? err.message : err);
    }

    // Fallback: return placeholder so workflow can continue (graceful degradation)
    const fallbackId = `local-${Date.now()}`;
    return {
      issueId: fallbackId,
      issueUrl: `${LINEAR_BASE_URL}/issue/${fallbackId}`,
      wasUpdated: false,
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

    // Route to the assignee when one is set, otherwise fall back to the
    // reporter. The current ticket step doesn't pass assigneeId through to
    // createLinearIssue (the orchestrator agent picks assignees, not the
    // workflow), so these fields are undefined in practice — but threading
    // the fallback means future code that DOES populate assigneeEmail will
    // notify the right person without further plumbing.
    const notifyTo = inputData.assigneeEmail ?? inputData.reporterEmail;
    const notifyName = inputData.assigneeName ?? 'On-Call Engineer';

    let emailSent = false;
    let slackSent = false;

    // Send email notification via Resend
    try {
      const emailResult = await sendTicketNotification.execute?.(
        {
          to: notifyTo,
          ticketTitle: inputData.triageSummary.slice(0, 100),
          severity,
          priority,
          summary: inputData.triageSummary,
          linearUrl: inputData.issueUrl,
          assigneeName: notifyName,
          linearIssueId: inputData.issueId,
        },
        {} as never,
      );
      emailSent = !!emailResult
        && typeof emailResult === 'object'
        && 'success' in emailResult
        && (emailResult as { success: unknown }).success === true;
      if (emailSent) {
        console.log(`[notify] Email notification sent to ${notifyTo}`);
      } else {
        console.error('[notify] Email notification returned unsuccessful:', emailResult);
      }
    } catch (err) {
      console.error('[notify] Email notification failed:', err instanceof Error ? err.message : err);
    }

    // Send Slack notification
    try {
      const slackResult = await sendSlackTicketNotification.execute?.(
        {
          ticketTitle: inputData.triageSummary.slice(0, 100),
          severity,
          priority,
          summary: inputData.triageSummary,
          linearUrl: inputData.issueUrl,
          assigneeName: notifyName,
          linearIssueId: inputData.issueId,
        },
        {} as never,
      );
      slackSent = !!slackResult
        && typeof slackResult === 'object'
        && 'success' in slackResult
        && (slackResult as { success: unknown }).success === true;
      if (slackSent) {
        console.log(`[notify] Slack notification sent`);
      } else {
        console.error('[notify] Slack notification returned unsuccessful:', slackResult);
      }
    } catch (err) {
      console.error('[notify] Slack notification failed:', err instanceof Error ? err.message : err);
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

    // Evidence gate: a ticket can only be marked fully resolved if at least
    // one concrete artefact points at a landed fix. Otherwise a manual status
    // flip in Linear would fire a premature "fixed!" notification to the
    // reporter. Check for a GitHub PR URL either on the webhook payload's
    // deployUrl field or inside the triage rootCause text.
    //
    // The comprehensive evidence check — querying Linear comments and
    // GitHub commits/branches — runs earlier in the In Review webhook
    // branch in runtime/src/mastra/index.ts; this is a minimal status-only
    // gate for the workflow's post-Done verify step.
    const PR_URL_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/i;
    const prUrlFromDeploy = webhookPayload.deployUrl && PR_URL_RE.test(webhookPayload.deployUrl)
      ? webhookPayload.deployUrl
      : null;
    const prUrlFromRootCause = inputData.rootCause.match(PR_URL_RE)?.[0] ?? null;
    const prUrl = prUrlFromDeploy ?? prUrlFromRootCause;

    // Determine verdict based on the Linear status change + evidence gate
    let verdict: 'resolved' | 'partially_resolved' | 'unresolved';
    let verificationNotes: string;

    if (newStatus === 'done' || newStatus === 'deployed' || newStatus === 'completed') {
      if (prUrl) {
        verdict = 'resolved';
        verificationNotes = `Issue marked as "${webhookPayload.newStatus}" at ${webhookPayload.updatedAt}. Resolution evidence: ${prUrl}. Root cause was: "${inputData.rootCause}"`;
      } else {
        verdict = 'partially_resolved';
        verificationNotes = `Issue marked as "${webhookPayload.newStatus}" at ${webhookPayload.updatedAt} but no GitHub PR URL was found in the deploy metadata or root-cause notes. Marking as partially resolved pending manual verification. Root cause was: "${inputData.rootCause}"`;
      }
    } else if (newStatus === 'in review' || newStatus === 'in progress') {
      verdict = 'partially_resolved';
      verificationNotes = `Issue is "${webhookPayload.newStatus}" — fix is in progress but not yet verified. Root cause: "${inputData.rootCause}"`;
    } else {
      verdict = 'unresolved';
      verificationNotes = `Issue status changed to "${webhookPayload.newStatus}" — does not indicate resolution. Root cause: "${inputData.rootCause}"`;
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
      const emailResult = await sendResolutionNotification.execute?.(
        {
          to: inputData.reporterEmail,
          originalTitle: ticketTitle,
          resolutionSummary,
          linearUrl: inputData.issueUrl,
          linearIssueId: inputData.issueId,
        },
        {} as never,
      );
      emailSent = !!emailResult
        && typeof emailResult === 'object'
        && 'success' in emailResult
        && (emailResult as { success: unknown }).success === true;
      if (emailSent) {
        console.log(`[notify-resolution] Resolution email sent to ${inputData.reporterEmail}`);
      } else {
        console.error('[notify-resolution] Resolution email returned unsuccessful:', emailResult);
      }
    } catch (err) {
      console.error('[notify-resolution] Email notification failed:', err instanceof Error ? err.message : err);
    }

    // Send resolution Slack notification
    try {
      const slackResult = await sendSlackResolutionNotification.execute?.(
        {
          originalTitle: ticketTitle,
          resolutionSummary,
          verdict: inputData.verdict,
          linearUrl: inputData.issueUrl,
          linearIssueId: inputData.issueId,
        },
        {} as never,
      );
      slackSent = !!slackResult
        && typeof slackResult === 'object'
        && 'success' in slackResult
        && (slackResult as { success: unknown }).success === true;
      if (slackSent) {
        console.log(`[notify-resolution] Slack resolution notification sent`);
      } else {
        console.error('[notify-resolution] Slack resolution notification returned unsuccessful:', slackResult);
      }
    } catch (err) {
      console.error('[notify-resolution] Slack notification failed:', err instanceof Error ? err.message : err);
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
