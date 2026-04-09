import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';

const SKIP = !process.env.LIBSQL_URL;

describe.skipIf(SKIP)('REQ-DB17: Schema Push Integration', () => {
  beforeAll(() => {
    // Run drizzle-kit push to apply schema to live LibSQL
    execSync('npx drizzle-kit push --force', {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: 'pipe',
    });
  });

  it('SHALL create all 7 tables', async () => {
    const { client } = await import('../../runtime/src/db/client');
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const tableNames = result.rows
      .map((r: any) => r.name as string)
      .filter(
        (n) =>
          !n.startsWith('_') &&
          !n.startsWith('libsql') &&
          !n.startsWith('mastra'),
      );
    expect(tableNames).toContain('auth_user');
    expect(tableNames).toContain('auth_session');
    expect(tableNames).toContain('auth_account');
    expect(tableNames).toContain('auth_verification');
    expect(tableNames).toContain('wiki_documents');
    expect(tableNames).toContain('wiki_chunks');
    expect(tableNames).toContain('local_tickets');
  });

  it('SHALL be idempotent on re-push', () => {
    expect(() => {
      execSync('npx drizzle-kit push --force', {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: 'pipe',
      });
    }).not.toThrow();
  });
});
