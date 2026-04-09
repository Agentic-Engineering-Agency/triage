/**
 * Zod schemas for Jira tool inputs.
 *
 * Follows the same conventions as ticket.ts (Linear schemas).
 * Project key defaults to 'KAN' (Solidus project on agenticengineering.atlassian.net).
 */

import { z } from 'zod';

// ============================================================
// Constants — Jira Cloud instance metadata
// ============================================================

export const JIRA_CONSTANTS = {
  /** Default project key (Solidus) */
  PROJECT_KEY: 'KAN',

  /** Issue type names available in KAN project */
  ISSUE_TYPES: {
    EPIC: 'Epic',
    SUBTASK: 'Subtask',
    TASK: 'Task',
    FEATURE: 'Feature',
    REQUEST: 'Request',
    BUG: 'Bug',
  } as const,

  /** Issue type IDs */
  ISSUE_TYPE_IDS: {
    EPIC: '10001',
    SUBTASK: '10002',
    TASK: '10003',
    FEATURE: '10004',
    REQUEST: '10005',
    BUG: '10006',
  } as const,

  /** Status IDs (next-gen project, shared across all issue types) */
  STATUSES: {
    TODO: '10000',        // "Por hacer"
    BACKLOG: '10003',     // "Backlog"
    IN_PROGRESS: '10001', // "En curso"
    IN_REVIEW: '10002',   // "En revisión"
    DONE: '10004',        // "Finalizado"
  } as const,

  /** Transition IDs (for POST /issue/{key}/transitions) */
  TRANSITIONS: {
    TODO: '11',
    IN_PROGRESS: '21',
    IN_REVIEW: '31',
    BACKLOG: '41',
    DONE: '51',
  } as const,

  /** Priority names */
  PRIORITIES: {
    HIGHEST: 'Highest',
    HIGH: 'High',
    MEDIUM: 'Medium',
    LOW: 'Low',
    LOWEST: 'Lowest',
  } as const,

  /** Fernando's account ID */
  ACCOUNT_ID_FERNANDO: '712020:e46f3f5c-445f-4c10-a45f-999014c11922',
} as const;

// ============================================================
// Tool input schemas
// ============================================================

/** Create a Jira issue */
export const jiraIssueCreateSchema = z.object({
  summary: z.string().min(1).describe('Issue title/summary'),
  description: z.string().default('').describe('Issue description (plain text, converted to ADF)'),
  issueType: z.string().default('Task').describe('Issue type name: Task, Bug, Feature, Epic, Request, Subtask'),
  projectKey: z.string().default('KAN').describe('Jira project key'),
  priority: z.string().optional().describe('Priority name: Highest, High, Medium, Low, Lowest'),
  labels: z.array(z.string()).optional().describe('Labels to apply'),
  assigneeAccountId: z.string().optional().describe('Assignee Atlassian account ID'),
  parentKey: z.string().optional().describe('Parent issue key (for subtasks)'),
});

/** Update a Jira issue */
export const jiraIssueUpdateSchema = z.object({
  issueKey: z.string().min(1).describe('Issue key (e.g. KAN-42)'),
  summary: z.string().optional().describe('Updated summary'),
  description: z.string().optional().describe('Updated description (plain text, converted to ADF)'),
  priority: z.string().optional().describe('Updated priority name'),
  labels: z.array(z.string()).optional().describe('Replace labels'),
  assigneeAccountId: z.string().optional().describe('New assignee account ID'),
});

/** Get a Jira issue by key */
export const jiraIssueKeySchema = z.object({
  issueKey: z.string().min(1).describe('Issue key (e.g. KAN-42)'),
});

/** Transition a Jira issue to a new status */
export const jiraTransitionSchema = z.object({
  issueKey: z.string().min(1).describe('Issue key (e.g. KAN-42)'),
  transitionId: z.string().min(1).describe('Transition ID (11=Todo, 21=InProgress, 31=InReview, 41=Backlog, 51=Done)'),
});

/** Add a comment to a Jira issue */
export const jiraCommentSchema = z.object({
  issueKey: z.string().min(1).describe('Issue key (e.g. KAN-42)'),
  body: z.string().min(1).describe('Comment text (plain text, converted to ADF)'),
});

/** Search Jira issues with JQL */
export const jiraSearchSchema = z.object({
  jql: z.string().min(1).describe('JQL query string'),
  maxResults: z.number().min(1).max(100).default(20).describe('Max results to return'),
  fields: z.array(z.string()).optional().describe('Fields to return (defaults to summary,status,priority,assignee,labels,issuetype)'),
});
