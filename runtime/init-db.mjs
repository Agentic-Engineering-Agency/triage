/**
 * Create auth and app tables in LibSQL if they don't exist.
 * Runs before the server starts in both dev and production Docker.
 */
import { createClient } from '@libsql/client';

const url = process.env.LIBSQL_URL || 'http://libsql:8080';
const client = createClient({ url });

const tables = [
  `CREATE TABLE IF NOT EXISTS auth_user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_session (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_account (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    id_token TEXT,
    access_token_expires_at INTEGER,
    refresh_token_expires_at INTEGER,
    scope TEXT,
    password TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repository_url TEXT NOT NULL,
    branch TEXT DEFAULT 'main',
    status TEXT NOT NULL DEFAULT 'pending',
    documents_count INTEGER NOT NULL DEFAULT 0,
    chunks_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    summary TEXT NOT NULL,
    pass INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES wiki_documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    embedding F32_BLOB(1536),
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS local_tickets (
    id TEXT PRIMARY KEY,
    linear_issue_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL,
    priority INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'triage',
    assignee_id TEXT REFERENCES auth_user(id),
    project_id TEXT REFERENCES projects(id),
    reporter_email TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    synced_at INTEGER
  )`,
];

for (const sql of tables) {
  const name = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
  await client.execute(sql);
  console.log(`[init-db] ${name} OK`);
}

// Idempotent ALTERs for columns added after initial table creation.
// SQLite has no native "ADD COLUMN IF NOT EXISTS", so we try/catch each one.
const alters = [
  { table: 'local_tickets', col: 'reporter_email', sql: `ALTER TABLE local_tickets ADD COLUMN reporter_email TEXT` },
  // project_id was added after the initial schema. Upgrade-in-place
  // databases won't pick it up from CREATE TABLE IF NOT EXISTS, so we
  // add it here too. Nullable on the upgrade path because existing rows
  // can't be backfilled without a project mapping — the fresh-install
  // schema above keeps wiki_documents.project_id NOT NULL because there
  // are no preexisting rows to worry about.
  { table: 'local_tickets', col: 'project_id', sql: `ALTER TABLE local_tickets ADD COLUMN project_id TEXT REFERENCES projects(id)` },
  { table: 'wiki_documents', col: 'project_id', sql: `ALTER TABLE wiki_documents ADD COLUMN project_id TEXT` },
];
for (const a of alters) {
  try {
    await client.execute(a.sql);
    console.log(`[init-db] ALTER ${a.table} ADD ${a.col} OK`);
    if (a.table === 'wiki_documents' && a.col === 'project_id') {
      console.warn(
        '[init-db] wiki_documents.project_id added as NULLABLE on the upgrade path. ' +
          'Fresh-install schema declares it NOT NULL — backfill existing rows with a ' +
          'valid project id before relying on the constraint.',
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('duplicate column') || msg.includes('already exists')) {
      console.log(`[init-db] ALTER ${a.table} ADD ${a.col} (already present)`);
    } else {
      console.warn('[init-db] ALTER skipped', { table: a.table, col: a.col, error: msg });
    }
  }
}

console.log('[init-db] All tables ready');
