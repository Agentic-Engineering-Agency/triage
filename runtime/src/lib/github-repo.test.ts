import { describe, it, expect } from 'vitest';
import {
  parseGithubRepoUrl,
  buildAuthenticatedCloneUrl,
  scrubPatFromString,
} from './github-repo';

describe('parseGithubRepoUrl', () => {
  it('parses https URL without .git suffix', () => {
    expect(parseGithubRepoUrl('https://github.com/vercel/next.js')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
    });
  });

  it('parses https URL with .git suffix', () => {
    expect(parseGithubRepoUrl('https://github.com/vercel/next.js.git')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
    });
  });

  it('parses https URL with trailing slash', () => {
    expect(parseGithubRepoUrl('https://github.com/vercel/next.js/')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
    });
  });

  it('parses SCP-style SSH URL (git@github.com:owner/repo.git)', () => {
    expect(parseGithubRepoUrl('git@github.com:vercel/next.js.git')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
    });
  });

  it('parses SCP-style SSH URL without .git', () => {
    expect(parseGithubRepoUrl('git@github.com:vercel/next.js')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
    });
  });

  it('parses ssh:// URL', () => {
    expect(parseGithubRepoUrl('ssh://git@github.com/vercel/next.js.git')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
    });
  });

  it('preserves owner/repo casing', () => {
    expect(parseGithubRepoUrl('https://github.com/Vercel/Next.JS')).toEqual({
      owner: 'Vercel',
      repo: 'Next.JS',
    });
  });

  it('tolerates http (not https)', () => {
    expect(parseGithubRepoUrl('http://github.com/a/b')).toEqual({
      owner: 'a',
      repo: 'b',
    });
  });

  it('rejects gitlab URL', () => {
    expect(parseGithubRepoUrl('https://gitlab.com/foo/bar')).toBeNull();
  });

  it('rejects bitbucket URL', () => {
    expect(parseGithubRepoUrl('https://bitbucket.org/foo/bar')).toBeNull();
  });

  it('rejects URL with extra path segment', () => {
    expect(parseGithubRepoUrl('https://github.com/owner/repo/tree/main')).toBeNull();
  });

  it('rejects empty / whitespace / non-string', () => {
    expect(parseGithubRepoUrl('')).toBeNull();
    expect(parseGithubRepoUrl('   ')).toBeNull();
    expect(parseGithubRepoUrl(null as unknown as string)).toBeNull();
  });

  it('rejects random garbage', () => {
    expect(parseGithubRepoUrl('not a url')).toBeNull();
    expect(parseGithubRepoUrl('https://example.com')).toBeNull();
  });
});

describe('buildAuthenticatedCloneUrl', () => {
  it('produces the x-access-token form', () => {
    expect(buildAuthenticatedCloneUrl('vercel', 'next.js', 'ghp_abc')).toBe(
      'https://x-access-token:ghp_abc@github.com/vercel/next.js.git',
    );
  });

  it('URL-encodes PATs with reserved characters', () => {
    // Contrived — GitHub PATs don't actually contain these, but the encoder
    // should round-trip safely regardless.
    const url = buildAuthenticatedCloneUrl('o', 'r', 'a:b@c/d');
    expect(url).toBe('https://x-access-token:a%3Ab%40c%2Fd@github.com/o/r.git');
  });
});

describe('scrubPatFromString', () => {
  it('redacts x-access-token:<pat>@ from clone-URL leaks', () => {
    const stderr =
      'fatal: unable to access https://x-access-token:ghp_leaked_abc@github.com/o/r.git/: 403';
    expect(scrubPatFromString(stderr)).toContain('x-access-token:***@');
    expect(scrubPatFromString(stderr)).not.toContain('ghp_leaked_abc');
  });

  it('redacts the literal PAT value when passed explicitly', () => {
    const msg = 'Token ghp_raw_abc123 was rejected';
    expect(scrubPatFromString(msg, 'ghp_raw_abc123')).toBe('Token *** was rejected');
  });

  it('is a no-op when no token appears', () => {
    expect(scrubPatFromString('clean message', 'ghp_xxx')).toBe('clean message');
  });

  it('handles regex-special characters in the PAT safely', () => {
    // Regex-special chars must be escaped — otherwise the replace would throw
    // or match the wrong thing.
    const pat = 'a.b+c*d';
    expect(scrubPatFromString(`leaked ${pat} here`, pat)).toBe('leaked *** here');
  });
});
