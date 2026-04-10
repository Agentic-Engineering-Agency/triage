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
    documents_count INTEGER NOT NULL DEFAULT 0,
    chunks_count INTEGER NOT NULL DEFAULT 0,
    wiki_error TEXT,
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
];

for (const sql of indexes) {
  await client.execute(sql);
  const name = sql.match(/idx_(\w+)/)[1];
  console.log(`[init-db] ${name} OK`);
}

console.log('[init-db] All tables and indexes ready');
