import { createTool } from '@mastra/core/tools';
import { githubPrCommentInputSchema, githubPrCommentOutputSchema } from '../../lib/schemas';

export const commentOnGitHubPRTool = createTool({
  id: 'comment-on-github-pr',
  description: 'Posts a code review comment on a GitHub pull request. Used after resolution verification to flag issues found by the code review agent.',
  inputSchema: githubPrCommentInputSchema,
  outputSchema: githubPrCommentOutputSchema,
  execute: async (input) => {
    try {
      const { prUrl, body } = input;

      // Extract owner, repo, and PR number from URL
      // Supports: https://github.com/{owner}/{repo}/pull/{number}
      const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (!match) {
        return { success: false, error: `Invalid GitHub PR URL format: ${prUrl}` };
      }

      const [, owner, repo, pullNumber] = match;
      const token = process.env.GITHUB_TOKEN;

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
