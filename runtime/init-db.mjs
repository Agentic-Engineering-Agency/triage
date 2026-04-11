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
    user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    repo_url TEXT NOT NULL,
    repo_default_branch TEXT DEFAULT 'main',
    linear_token TEXT,
    linear_team_id TEXT,
    linear_webhook_id TEXT,
    linear_webhook_url TEXT,
    slack_enabled INTEGER DEFAULT 0,
    slack_channel_id TEXT,
    slack_webhook_url TEXT,
    github_token TEXT,
    github_repo_owner TEXT,
    github_repo_name TEXT,
    resend_api_key TEXT,
    reporter_email TEXT,
    wiki_status TEXT DEFAULT 'idle',
    status TEXT NOT NULL DEFAULT 'pending',
    documents_count INTEGER NOT NULL DEFAULT 0,
    chunks_count INTEGER NOT NULL DEFAULT 0,
    wiki_error TEXT,
    error TEXT,
    last_wiki_generated_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS linear_issues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    linear_id TEXT NOT NULL,
    identifier TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT,
    priority INTEGER,
    estimate INTEGER,
    assignee_id TEXT,
    labels TEXT,
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
  `CREATE TABLE IF NOT EXISTS linear_sync_cache (
    id TEXT PRIMARY KEY DEFAULT 'default',
    team_id TEXT NOT NULL,
    data TEXT NOT NULL,
    synced_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS local_tickets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    linear_issue_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL,
    priority INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'triage',
    assignee_id TEXT REFERENCES auth_user(id),
    reporter_email TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    synced_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE,
    thread_id TEXT NOT NULL,
    issue_id TEXT,
    issue_url TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS card_states (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    tool_index INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'confirmed',
    linear_url TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS llm_usage (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    agent_id TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    thread_id TEXT,
    created_at INTEGER NOT NULL
  )`,
];

for (const sql of tables) {
  const name = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
  await client.execute(sql);
  console.log(`[init-db] ${name} OK`);
}

// Create indexes for query performance
const indexes = [
  `CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_project_user ON conversations(project_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_linear_issues_project_id ON linear_issues(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_linear_issues_identifier ON linear_issues(identifier)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_documents_project_id ON wiki_documents(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_chunks_document_id ON wiki_chunks(document_id)`,
  `CREATE INDEX IF NOT EXISTS idx_local_tickets_project_id ON local_tickets(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_card_states_thread_id ON card_states(thread_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_runs_run_id ON workflow_runs(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_runs_issue_id ON workflow_runs(issue_id)`,
  `CREATE INDEX IF NOT EXISTS idx_llm_usage_project_id ON llm_usage(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage(created_at)`,
];

for (const sql of indexes) {
  await client.execute(sql);
  const name = sql.match(/idx_(\w+)/)[1];
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

console.log('[init-db] All tables and indexes ready');
