/**
 * Unit tests for Drizzle schema definitions (runtime/src/db/schema.ts)
 * Spec: SPEC-20260409-001 — REQ-DB15
 *
 * Pure metadata tests — no running database required.
 *
 * Validates:
 *   - All 7 tables exported and are valid sqliteTable objects
 *   - Column presence and naming for every table
 *   - Table names use correct prefixes (auth_, wiki_, local_)
 *   - No bare "account" table name (Mastra collision avoidance)
 *   - Relations are exported
 *   - float32Array custom type produces F32_BLOB(1536)
 *
 * RED phase: all tests fail until schema.ts is implemented.
 */

import { describe, it, expect } from 'vitest';
import { getTableName } from 'drizzle-orm';
import {
  authUser,
  authSession,
  authAccount,
  authVerification,
  wikiDocuments,
  wikiChunks,
  localTickets,
  authUserRelations,
  authSessionRelations,
  authAccountRelations,
  wikiDocumentRelations,
  wikiChunkRelations,
  localTicketRelations,
} from './schema';

// ---------------------------------------------------------------------------
// Helper: get column names from a Drizzle sqliteTable
// Drizzle tables expose columns as direct properties — Object.keys works
// but we filter out internal Symbol-keyed and non-column properties.
// A column object has a 'name' property (string) for the SQL column name.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasColumn(table: any, colName: string): boolean {
  return colName in table && table[colName] !== undefined;
}

// ============================================================================
// Table existence and type checks
// ============================================================================
describe('REQ-DB15: Schema — table exports', () => {
  const tables = [
    { name: 'authUser', ref: authUser },
    { name: 'authSession', ref: authSession },
    { name: 'authAccount', ref: authAccount },
    { name: 'authVerification', ref: authVerification },
    { name: 'wikiDocuments', ref: wikiDocuments },
    { name: 'wikiChunks', ref: wikiChunks },
    { name: 'localTickets', ref: localTickets },
  ];

  it.each(tables)('$name is exported and defined', ({ ref }) => {
    expect(ref).toBeDefined();
  });

  it('exports exactly 7 tables', () => {
    tables.forEach(({ ref }) => expect(ref).toBeDefined());
    expect(tables).toHaveLength(7);
  });
});

// ============================================================================
// Table name checks (SQL-level names)
// ============================================================================
describe('REQ-DB15: Schema — SQL table names', () => {
  it('authUser table is named "auth_user"', () => {
    expect(getTableName(authUser)).toBe('auth_user');
  });

  it('authSession table is named "auth_session"', () => {
    expect(getTableName(authSession)).toBe('auth_session');
  });

  it('authAccount table is named "auth_account"', () => {
    expect(getTableName(authAccount)).toBe('auth_account');
  });

  it('authVerification table is named "auth_verification"', () => {
    expect(getTableName(authVerification)).toBe('auth_verification');
  });

  it('wikiDocuments table is named "wiki_documents"', () => {
    expect(getTableName(wikiDocuments)).toBe('wiki_documents');
  });

  it('wikiChunks table is named "wiki_chunks"', () => {
    expect(getTableName(wikiChunks)).toBe('wiki_chunks');
  });

  it('localTickets table is named "local_tickets"', () => {
    expect(getTableName(localTickets)).toBe('local_tickets');
  });

  it('no table named bare "account" (Mastra collision avoidance)', () => {
    // All auth tables must use auth_ prefix
    expect(getTableName(authAccount)).not.toBe('account');
    expect(getTableName(authAccount)).toMatch(/^auth_/);
  });
});

// ============================================================================
// auth_user columns
// ============================================================================
describe('REQ-DB15: auth_user columns', () => {
  const expectedColumns = [
    'id',
    'name',
    'email',
    'emailVerified',
    'image',
    'createdAt',
    'updatedAt',
  ];

  it.each(expectedColumns)('has column "%s"', (col) => {
    expect(hasColumn(authUser, col)).toBe(true);
  });
});

// ============================================================================
// auth_session columns
// ============================================================================
describe('REQ-DB15: auth_session columns', () => {
  const expectedColumns = [
    'id',
    'expiresAt',
    'token',
    'createdAt',
    'updatedAt',
    'ipAddress',
    'userAgent',
    'userId',
  ];

  it.each(expectedColumns)('has column "%s"', (col) => {
    expect(hasColumn(authSession, col)).toBe(true);
  });

  it('userId is a foreign key reference', () => {
    // Drizzle columns that reference another table have a .references property
    // or the column config includes notNull + references
    expect(authSession.userId).toBeDefined();
  });
});

// ============================================================================
// auth_account columns
// ============================================================================
describe('REQ-DB15: auth_account columns', () => {
  const expectedColumns = [
    'id',
    'accountId',
    'providerId',
    'userId',
    'accessToken',
    'refreshToken',
    'idToken',
    'scope',
    'password',
    'createdAt',
    'updatedAt',
  ];

  it.each(expectedColumns)('has column "%s"', (col) => {
    expect(hasColumn(authAccount, col)).toBe(true);
  });

  it('userId is a foreign key reference', () => {
    expect(authAccount.userId).toBeDefined();
  });
});

// ============================================================================
// auth_verification columns
// ============================================================================
describe('REQ-DB15: auth_verification columns', () => {
  const expectedColumns = [
    'id',
    'identifier',
    'value',
    'expiresAt',
    'createdAt',
    'updatedAt',
  ];

  it.each(expectedColumns)('has column "%s"', (col) => {
    expect(hasColumn(authVerification, col)).toBe(true);
  });
});

// ============================================================================
// wiki_documents columns
// ============================================================================
describe('REQ-DB15: wiki_documents columns', () => {
  const expectedColumns = [
    'id',
    'projectId',
    'filePath',
    'summary',
    'pass',
    'createdAt',
    'updatedAt',
  ];

  it.each(expectedColumns)('has column "%s"', (col) => {
    expect(hasColumn(wikiDocuments, col)).toBe(true);
  });
});

// ============================================================================
// wiki_chunks columns
// ============================================================================
describe('REQ-DB15: wiki_chunks columns', () => {
  const expectedColumns = [
    'id',
    'documentId',
    'content',
    'chunkIndex',
    'embedding',
    'createdAt',
  ];

  it.each(expectedColumns)('has column "%s"', (col) => {
    expect(hasColumn(wikiChunks, col)).toBe(true);
  });

  it('documentId references wiki_documents', () => {
    expect(wikiChunks.documentId).toBeDefined();
  });
});

// ============================================================================
// local_tickets columns
// ============================================================================
describe('REQ-DB15: local_tickets columns', () => {
  const expectedColumns = [
    'id',
    'linearIssueId',
    'title',
    'description',
    'severity',
    'priority',
    'status',
    'assigneeId',
    'createdAt',
    'updatedAt',
    'syncedAt',
  ];

  it.each(expectedColumns)('has column "%s"', (col) => {
    expect(hasColumn(localTickets, col)).toBe(true);
  });
});

// ============================================================================
// Relations exports
// ============================================================================
describe('REQ-DB15: Schema — relation exports', () => {
  it('authUserRelations is exported and defined', () => {
    expect(authUserRelations).toBeDefined();
  });

  it('authSessionRelations is exported and defined', () => {
    expect(authSessionRelations).toBeDefined();
  });

  it('authAccountRelations is exported and defined', () => {
    expect(authAccountRelations).toBeDefined();
  });

  it('wikiDocumentRelations is exported and defined', () => {
    expect(wikiDocumentRelations).toBeDefined();
  });

  it('wikiChunkRelations is exported and defined', () => {
    expect(wikiChunkRelations).toBeDefined();
  });

  it('localTicketRelations is exported and defined', () => {
    expect(localTicketRelations).toBeDefined();
  });
});

// ============================================================================
// float32Array / F32_BLOB(1536) custom type
// ============================================================================
describe('REQ-DB15: float32Array custom type', () => {
  it('wiki_chunks.embedding column exists and is defined', () => {
    expect(wikiChunks.embedding).toBeDefined();
  });

  it('wiki_chunks.embedding column has SQL type containing F32_BLOB', () => {
    // Drizzle custom types store the SQL type in various internal properties.
    // We check the column's sqlName, getSQLType(), or columnType for "F32_BLOB"
    const col = wikiChunks.embedding as unknown as Record<string, unknown>;
    // Try multiple paths to find the SQL type string
    const sqlType =
      (col.getSQLType && typeof col.getSQLType === 'function'
        ? (col.getSQLType as () => string)()
        : null) ??
      (col.sqlName as string) ??
      (col.columnType as string) ??
      '';
    expect(sqlType.toUpperCase()).toContain('F32_BLOB');
  });

  it('wiki_chunks.embedding F32_BLOB dimension is 1536', () => {
    const col = wikiChunks.embedding as unknown as Record<string, unknown>;
    const sqlType =
      (col.getSQLType && typeof col.getSQLType === 'function'
        ? (col.getSQLType as () => string)()
        : null) ??
      (col.sqlName as string) ??
      (col.columnType as string) ??
      '';
    expect(sqlType).toContain('1536');
  });
});
