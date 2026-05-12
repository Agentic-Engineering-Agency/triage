import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { resolveKey } from '../../lib/tenant-keys';
import { githubPrCommentInputSchema, githubPrCommentOutputSchema } from '../../lib/schemas';

type ToolCtx = { requestContext?: { get: (key: string) => unknown } } | undefined;

export const commentOnGitHubPRTool = createTool({
  id: 'comment-on-github-pr',
  description: 'Posts a code review comment on a GitHub pull request. Used after resolution verification to flag issues found by the code review agent.',
  inputSchema: githubPrCommentInputSchema,
  outputSchema: githubPrCommentOutputSchema,
  execute: async (input, toolCtx?: ToolCtx) => {
    try {
      const { prUrl, body } = input;

      // Extract owner, repo, and PR number from URL
      // Supports: https://github.com/{owner}/{repo}/pull/{number}
      const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (!match) {
        return { success: false, error: `Invalid GitHub PR URL format: ${prUrl}` };
      }

      const [, owner, repo, pullNumber] = match;
      const projectId = toolCtx?.requestContext?.get('projectId') as string | undefined;
      const { key: token } = await resolveKey('github', projectId);

      if (!token) {
        return { success: false, error: 'GITHUB_TOKEN environment variable is not set' };
      }

      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${pullNumber}/comments`,
        {
          method: 'POST',
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'triage-sre-agent',
          },
          body: JSON.stringify({ body }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: `GitHub API error ${response.status}: ${(errorData as Record<string, unknown>).message ?? response.statusText}`,
        };
      }

      const data = await response.json() as { html_url?: string };
      return {
        success: true,
        commentUrl: data.html_url ?? '',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to comment on PR: ${message}` };
    }
  },
});

// ---------------------------------------------------------------------------
// findGitHubEvidenceForIssueTool — searches a GitHub repo for commits,
// branches, and PRs whose text mentions a Linear issue identifier (e.g.
// "SOL-123"). Used by the In Review evidence check to decide whether a
// ticket has verifiable completion evidence before auto-transitioning to
// Done.
// ---------------------------------------------------------------------------

// Linear identifiers are TEAMKEY-NUMBER (e.g. SOL-123). Paranoid regex:
// anchored, bounded lengths, single-pass — no catastrophic backtracking.
const IDENTIFIER_RE = /^[A-Z]{2,10}-[0-9]{1,8}$/;

function scrubToken(msg: string, token?: string | null): string {
  if (token && msg.includes(token)) {
    return msg.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[REDACTED]');
  }
  return msg;
}

export const findGitHubEvidenceForIssueTool = createTool({
  id: 'find-github-evidence-for-issue',
  description: 'Search a GitHub repository for commits, branches, and PRs that reference a Linear issue identifier (e.g. "SOL-123"). Returns aggregated evidence with a plain-text summary suitable for notification bodies.',
  inputSchema: z.object({
    owner: z.string().min(1).max(100),
    repo: z.string().min(1).max(100),
    identifier: z.string().min(3).max(30).describe('Linear issue identifier like SOL-123'),
  }),
  execute: async (input, toolCtx?: ToolCtx) => {
    const { owner, repo, identifier } = input;
    if (!IDENTIFIER_RE.test(identifier)) {
      return { success: false, error: 'Invalid identifier format (expected TEAM-NUMBER)' };
    }

    const projectId = toolCtx?.requestContext?.get('projectId') as string | undefined;
    const { key: token } = await resolveKey('github', projectId);
    if (!token) {
      return {
        success: false,
        error: 'GITHUB_TOKEN not set — cannot fetch GitHub evidence',
      };
    }

    const headers = {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'triage-sre-agent',
    } as const;

    const encId = encodeURIComponent(identifier);
    const encOwner = encodeURIComponent(owner);
    const encRepo = encodeURIComponent(repo);
    const commitsUrl = `https://api.github.com/search/commits?q=${encId}+repo:${encOwner}/${encRepo}`;
    const branchesUrl = `https://api.github.com/repos/${encOwner}/${encRepo}/branches?per_page=100`;
    const pullsUrl = `https://api.github.com/search/issues?q=${encId}+repo:${encOwner}/${encRepo}+is:pr`;

    const handleStatus = (status: number, label: string): string | null => {
      if (status === 403) return `${label}: rate limited or forbidden`;
      if (status === 404) return `${label}: repo not found`;
      if (!(status >= 200 && status < 300)) return `${label}: HTTP ${status}`;
      return null;
    };

    try {
      const [commitsRes, branchesRes, pullsRes] = await Promise.all([
        fetch(commitsUrl, { headers }),
        fetch(branchesUrl, { headers }),
        fetch(pullsUrl, { headers }),
      ]);

      const errors: string[] = [];
      const commitsErr = handleStatus(commitsRes.status, 'commits');
      const branchesErr = handleStatus(branchesRes.status, 'branches');
      const pullsErr = handleStatus(pullsRes.status, 'pulls');
      if (commitsErr) errors.push(commitsErr);
      if (branchesErr) errors.push(branchesErr);
      if (pullsErr) errors.push(pullsErr);

      type CommitItem = { sha?: string; html_url?: string; commit?: { message?: string } };
      type BranchItem = { name?: string; commit?: { sha?: string; url?: string } };
      type PullItem = { number?: number; title?: string; html_url?: string; state?: string };

      const commitsData = commitsRes.ok ? (await commitsRes.json().catch(() => ({}))) as { items?: CommitItem[] } : { items: [] };
      const branchesData = branchesRes.ok ? (await branchesRes.json().catch(() => [])) as BranchItem[] : [];
      const pullsData = pullsRes.ok ? (await pullsRes.json().catch(() => ({}))) as { items?: PullItem[] } : { items: [] };

      const commits = (commitsData.items ?? []).slice(0, 10).map((c) => ({
        sha: (c.sha ?? '').slice(0, 12),
        message: (c.commit?.message ?? '').split('\n')[0].slice(0, 200),
        htmlUrl: c.html_url ?? '',
      }));

      const needle = identifier.toLowerCase();
      const branches = (Array.isArray(branchesData) ? branchesData : [])
        .filter((b) => typeof b?.name === 'string' && b.name.toLowerCase().includes(needle))
        .slice(0, 10)
        .map((b) => ({
          name: b.name as string,
          htmlUrl: `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(b.name as string)}`,
        }));

      const pulls = (pullsData.items ?? []).slice(0, 10).map((p) => ({
        number: p.number ?? 0,
        title: (p.title ?? '').slice(0, 200),
        htmlUrl: p.html_url ?? '',
        state: p.state ?? 'unknown',
      }));

      const found = commits.length > 0 || branches.length > 0 || pulls.length > 0;

      const parts: string[] = [];
      if (commits.length > 0) parts.push(`${commits.length} commit(s)`);
      if (branches.length > 0) parts.push(`${branches.length} branch(es)`);
      if (pulls.length > 0) parts.push(`${pulls.length} PR(s)`);
      const evidenceSummary = found
        ? `Found ${parts.join(', ')} referencing ${identifier} in ${owner}/${repo}.${pulls[0] ? ` Latest PR: ${pulls[0].htmlUrl}` : ''}`
        : `No commits, branches, or PRs referencing ${identifier} in ${owner}/${repo}.`;

      return {
        success: true,
        data: {
          found,
          commits,
          branches,
          pulls,
          evidenceSummary,
          partialErrors: errors,
        },
      };
    } catch (error) {
      const message = scrubToken(error instanceof Error ? error.message : String(error), token);
      return { success: false, error: `GitHub evidence lookup failed: ${message.slice(0, 200)}` };
    }
  },
});
