/**
 * GitHub repository URL parsing + authenticated clone URL construction.
 *
 * Used by the #5d unification path: POST /projects probes the public GitHub
 * API to detect privacy, PUT /integrations/github validates repo access, and
 * wiki-rag injects a PAT into the clone URL when the repo is private.
 *
 * Everything in this file is GitHub-specific on purpose. Non-GitHub repos
 * (GitLab, Bitbucket, self-hosted) bypass the probe + auth path; callers
 * check `parseGithubRepoUrl(url) === null` to branch.
 */

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

/**
 * Parse a GitHub repository URL into {owner, repo}. Returns null if the URL
 * is not a GitHub URL or is unparseable. The check is strict on host — any
 * non-`github.com` host returns null so the caller can treat it as a
 * non-GitHub repo and skip the probe.
 *
 * Accepts:
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 *   - https://github.com/owner/repo/  (trailing slash)
 *   - http://github.com/owner/repo
 *   - git@github.com:owner/repo.git
 *   - git@github.com:owner/repo
 *   - ssh://git@github.com/owner/repo
 *   - ssh://git@github.com/owner/repo.git
 *
 * Owner/repo preserved as typed (GitHub is case-insensitive on lookup but
 * case-preserving in the canonical URL — we keep the input casing).
 */
export function parseGithubRepoUrl(url: string): GithubRepoRef | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // git@github.com:owner/repo(.git)
  const scpMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (scpMatch) {
    const owner = scpMatch[1];
    const repo = scpMatch[2];
    if (owner && repo) return { owner, repo };
    return null;
  }

  // ssh://git@github.com/owner/repo(.git) and http(s)://github.com/owner/repo(.git)
  const urlMatch = /^(?:https?|ssh):\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (urlMatch) {
    const owner = urlMatch[1];
    const repo = urlMatch[2];
    if (owner && repo) return { owner, repo };
    return null;
  }

  return null;
}

/**
 * Build an HTTPS clone URL that embeds a GitHub PAT for private-repo access.
 *
 * The `x-access-token:<pat>@github.com/...` form is the documented way to use
 * a PAT with git — the username is literal "x-access-token" and the PAT goes
 * in the password slot. The PAT is URL-encoded so unlikely reserved chars
 * (`@`, `:`, `/`) round-trip safely through the URL parser that git spawns.
 */
export function buildAuthenticatedCloneUrl(
  owner: string,
  repo: string,
  pat: string,
): string {
  return `https://x-access-token:${encodeURIComponent(pat)}@github.com/${owner}/${repo}.git`;
}

/**
 * Redact a GitHub PAT from a string before logging or persisting it.
 *
 * Removes:
 *   - The `x-access-token:<anything>@` prefix that appears in clone URLs
 *     embedded in git stderr.
 *   - The literal PAT value if the caller passes one in (belt-and-suspenders
 *     for cases where git echoes the token raw, e.g. in auth error traces).
 *
 * Callers must still avoid stuffing PATs into logs they control — this is a
 * last-line scrub for output they didn't produce (exec stderr, third-party
 * error messages).
 */
export function scrubPatFromString(input: string, pat?: string): string {
  let out = input.replace(/x-access-token:[^@\s]*@/gi, 'x-access-token:***@');
  if (pat && pat.length > 0) {
    const escaped = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), '***');
  }
  return out;
}
