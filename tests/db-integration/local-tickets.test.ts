import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { eq } from 'drizzle-orm';

const SKIP = !process.env.LIBSQL_URL;

describe.skipIf(SKIP)('REQ-DB19: Local Tickets CRUD Integration', () => {
  let db: any;
  let localTickets: any;
  let client: any;
  const testTicketId = `test-ticket-${Date.now()}`;

  beforeAll(async () => {
    // Ensure schema is applied
    execSync('npx drizzle-kit migrate', {
      cwd: process.cwd() + '/runtime',
      env: { ...process.env },
      stdio: 'pipe',
    });

    const clientMod = await import('../../runtime/src/db/client');
    db = clientMod.db;
    client = clientMod.client;

    const schemaMod = await import('../../runtime/src/db/schema');
    localTickets = schemaMod.localTickets;
  });

  afterAll(async () => {
    if (!client) return;
    // Clean up any remaining test data
    await client.execute({
      sql: `DELETE FROM local_tickets WHERE id LIKE 'test-ticket-%'`,
      args: [],
    });
  });

  it('SHALL insert a ticket with linearIssueId=null and status=triage', async () => {
    const inserted = await db
      .insert(localTickets)
      .values({
        id: testTicketId,
        title: 'Test Incident: Payment Gateway Timeout',
        description: 'Payments failing with 504 errors on checkout',
        severity: 'sev1',
        status: 'triage',
        reporterEmail: 'oncall@example.com',
        linearIssueId: null,
        syncedAt: null,
      })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0].id).toBe(testTicketId);
    expect(inserted[0].status).toBe('triage');
    expect(inserted[0].linearIssueId).toBeNull();
  });

  it('SHALL read back the inserted ticket', async () => {
    const rows = await db
      .select()
      .from(localTickets)
      .where(eq(localTickets.id, testTicketId));

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Test Incident: Payment Gateway Timeout');
    expect(rows[0].severity).toBe('sev1');
    expect(rows[0].status).toBe('triage');
    expect(rows[0].linearIssueId).toBeNull();
    expect(rows[0].syncedAt).toBeNull();
  });

  it('SHALL update linearIssueId and syncedAt', async () => {
    const now = new Date().toISOString();
    const updated = await db
      .update(localTickets)
      .set({
        linearIssueId: 'TRI-42',
        syncedAt: now,
        status: 'synced',
      })
      .where(eq(localTickets.id, testTicketId))
      .returning();

    expect(updated).toHaveLength(1);
    expect(updated[0].linearIssueId).toBe('TRI-42');
    expect(updated[0].syncedAt).toBe(now);
    expect(updated[0].status).toBe('synced');
  });

  it('SHALL read the updated ticket with new values', async () => {
    const rows = await db
      .select()
      .from(localTickets)
      .where(eq(localTickets.id, testTicketId));

    expect(rows).toHaveLength(1);
    expect(rows[0].linearIssueId).toBe('TRI-42');
    expect(rows[0].status).toBe('synced');
  });

  it('SHALL delete the ticket', async () => {
    const deleted = await db
      .delete(localTickets)
      .where(eq(localTickets.id, testTicketId))
      .returning();

    expect(deleted).toHaveLength(1);
    expect(deleted[0].id).toBe(testTicketId);
  });

  it('SHALL confirm ticket is gone after delete', async () => {
    const rows = await db
      .select()
      .from(localTickets)
      .where(eq(localTickets.id, testTicketId));

    expect(rows).toHaveLength(0);
  });

  it('SHALL filter tickets by severity and status', async () => {
    // Insert multiple tickets with different severities/statuses
    const tickets = [
      {
        id: `test-ticket-filter-sev1`,
        title: 'Sev1 triage',
        description: 'Critical issue',
        severity: 'sev1',
        status: 'triage',
        reporterEmail: 'a@example.com',
        linearIssueId: null,
        syncedAt: null,
      },
      {
        id: `test-ticket-filter-sev2`,
        title: 'Sev2 triage',
        description: 'Major issue',
        severity: 'sev2',
        status: 'triage',
        reporterEmail: 'b@example.com',
        linearIssueId: null,
        syncedAt: null,
      },
      {
        id: `test-ticket-filter-resolved`,
        title: 'Sev1 resolved',
        description: 'Was critical, now resolved',
        severity: 'sev1',
        status: 'resolved',
        reporterEmail: 'c@example.com',
        linearIssueId: 'TRI-99',
        syncedAt: new Date().toISOString(),
      },
    ];

    for (const t of tickets) {
      await db.insert(localTickets).values(t);
    }

    try {
      // Filter by severity
      const sev1Rows = await db
        .select()
        .from(localTickets)
        .where(eq(localTickets.severity, 'sev1'));

      const sev1Ids = sev1Rows.map((r: any) => r.id);
      expect(sev1Ids).toContain('test-ticket-filter-sev1');
      expect(sev1Ids).toContain('test-ticket-filter-resolved');
      expect(sev1Ids).not.toContain('test-ticket-filter-sev2');

      // Filter by status
      const triageRows = await db
        .select()
        .from(localTickets)
        .where(eq(localTickets.status, 'triage'));

      const triageIds = triageRows.map((r: any) => r.id);
      expect(triageIds).toContain('test-ticket-filter-sev1');
      expect(triageIds).toContain('test-ticket-filter-sev2');
      expect(triageIds).not.toContain('test-ticket-filter-resolved');
    } finally {
      // Clean up filter test data
      for (const t of tickets) {
        await db
          .delete(localTickets)
          .where(eq(localTickets.id, t.id));
      }
    }
  });
});
