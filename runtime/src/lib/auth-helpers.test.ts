import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient } from '@libsql/client';
import type { Context } from 'hono';
import {
  __setClientForTests,
  extractSessionToken,
  getUserIdFromRequest,
} from './auth-helpers';

async function freshMemoryDb() {
  const client = createClient({ url: ':memory:' });
  await client.execute(`
    CREATE TABLE auth_session (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  return client;
}

function makeCtx(cookieHeader: string | undefined): Context {
  return {
    req: { header: (name: string) => (name === 'cookie' ? cookieHeader : undefined) },
  } as unknown as Context;
}

describe('extractSessionToken', () => {
  it('returns null for missing cookie header', () => {
    expect(extractSessionToken(undefined)).toBeNull();
    expect(extractSessionToken(null)).toBeNull();
    expect(extractSessionToken('')).toBeNull();
  });

  it('returns null when cookie has no better-auth entry', () => {
    expect(extractSessionToken('other=value; something=else')).toBeNull();
  });

  it('extracts token without signature', () => {
    expect(extractSessionToken('better-auth.session_token=abc123')).toBe('abc123');
  });

  it('strips the .signature suffix', () => {
    expect(extractSessionToken('better-auth.session_token=abc123.sig456')).toBe('abc123');
  });

  it('decodes URL-encoded cookie values', () => {
    const encoded = encodeURIComponent('tok+with/special=chars.sig');
    expect(extractSessionToken(`better-auth.session_token=${encoded}`)).toBe('tok+with/special=chars');
  });

  it('picks better-auth.session_token when surrounded by other cookies', () => {
    const header = 'foo=bar; better-auth.session_token=the-token.sig; baz=qux';
    expect(extractSessionToken(header)).toBe('the-token');
  });
});

describe('getUserIdFromRequest', () => {
  beforeEach(async () => {
    const client = await freshMemoryDb();
    const now = Date.now();
    await client.execute({
      sql: 'INSERT INTO auth_session (id, user_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: ['s1', 'user-42', 'valid-token', now + 1_000_000, now, now],
    });
    __setClientForTests(client);
  });

  afterEach(() => {
    __setClientForTests(null);
  });

  it('returns null when no cookie is present', async () => {
    const ctx = makeCtx(undefined);
    expect(await getUserIdFromRequest(ctx)).toBeNull();
  });

  it('returns null when token does not match any session', async () => {
    const ctx = makeCtx('better-auth.session_token=unknown.sig');
    expect(await getUserIdFromRequest(ctx)).toBeNull();
  });

  it('returns the user id for a matching session', async () => {
    const ctx = makeCtx('better-auth.session_token=valid-token.sig');
    expect(await getUserIdFromRequest(ctx)).toBe('user-42');
  });

  it('works when the token has no signature suffix', async () => {
    const ctx = makeCtx('better-auth.session_token=valid-token');
    expect(await getUserIdFromRequest(ctx)).toBe('user-42');
  });
});
