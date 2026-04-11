import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { float32Array } from './custom-types';

/**
 * Better Auth + Drizzle/LibSQL Authentication Schema
 * Tables: auth_user, auth_session, auth_account, auth_verification
 * Prefixed with "auth_" to avoid conflict with Mastra's existing "account" table.
 *
 * Additional: wiki_documents, wiki_chunks (RAG vectors), local_tickets (graceful degradation)
 */

export const authUser = sqliteTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const authSession = sqliteTable('auth_session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const authAccount = sqliteTable('auth_account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const authVerification = sqliteTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ─── Projects ────────────────────────────────────────────────

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  repoUrl: text('repo_url').notNull(),
  repoDefaultBranch: text('repo_default_branch').default('main'),

  // Linear integration
  linearToken: text('linear_token'),
  linearTeamId: text('linear_team_id'),
  linearWebhookId: text('linear_webhook_id'),
  linearWebhookUrl: text('linear_webhook_url'),

  // Slack integration
  slackEnabled: integer('slack_enabled', { mode: 'boolean' }).default(false),
  slackChannelId: text('slack_channel_id'),
  slackWebhookUrl: text('slack_webhook_url'),

  // GitHub integration
  githubToken: text('github_token'),
  githubRepoOwner: text('github_repo_owner'),
  githubRepoName: text('github_repo_name'),

  // Email
  resendApiKey: text('resend_api_key'),
  reporterEmail: text('reporter_email'),

  // Wiki/RAG
  wikiStatus: text('wiki_status').default('idle'),
  documentsCount: integer('documents_count').default(0),
  chunksCount: integer('chunks_count').default(0),
  wikiError: text('wiki_error'),
  lastWikiGeneratedAt: integer('last_wiki_generated_at'),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ─── Conversations & Messages ────────────────────────────────────

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ─── Linear Sync Cache ───────────────────────────────────────────

export const linearSyncCache = sqliteTable('linear_sync_cache', {
  id: text('id').primaryKey().default('default'),
  teamId: text('team_id').notNull(),
  data: text('data').notNull(),
  syncedAt: integer('synced_at', { mode: 'timestamp' }).notNull(),
});

// ─── Linear Issues ────────────────────────────────────────────────

export const linearIssues = sqliteTable('linear_issues', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  linearId: text('linear_id').notNull(),
  identifier: text('identifier').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status'),
  priority: integer('priority'),
  estimate: integer('estimate'),
  assigneeId: text('assignee_id'),
  labels: text('labels'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ─── Wiki Tables ────────────────────────────────────────────────

export const wikiDocuments = sqliteTable('wiki_documents', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  filePath: text('file_path').notNull(),
  summary: text('summary').notNull(),
  pass: integer('pass').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const wikiChunks = sqliteTable('wiki_chunks', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => wikiDocuments.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  embedding: float32Array('embedding', { dimensions: 1536 }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ─── Local Tickets ──────────────────────────────────────────────

export const localTickets = sqliteTable('local_tickets', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  linearIssueId: text('linear_issue_id'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  severity: text('severity').notNull(),
  priority: integer('priority').notNull(),
  status: text('status').notNull().default('triage'),
  assigneeId: text('assignee_id').references(() => authUser.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  syncedAt: integer('synced_at', { mode: 'timestamp' }),
});

// ─── Relations ──────────────────────────────────────────────────

export const authUserRelations = relations(authUser, ({ many }) => ({
  sessions: many(authSession),
  accounts: many(authAccount),
  projects: many(projects),
  conversations: many(conversations),
  localTickets: many(localTickets),
}));

export const authSessionRelations = relations(authSession, ({ one }) => ({
  user: one(authUser, {
    fields: [authSession.userId],
    references: [authUser.id],
  }),
}));

export const authAccountRelations = relations(authAccount, ({ one }) => ({
  user: one(authUser, {
    fields: [authAccount.userId],
    references: [authUser.id],
  }),
}));

export const projectRelations = relations(projects, ({ one, many }) => ({
  user: one(authUser, {
    fields: [projects.userId],
    references: [authUser.id],
  }),
  conversations: many(conversations),
  linearIssues: many(linearIssues),
  wikiDocuments: many(wikiDocuments),
  localTickets: many(localTickets),
}));

export const conversationRelations = relations(conversations, ({ one, many }) => ({
  project: one(projects, {
    fields: [conversations.projectId],
    references: [projects.id],
  }),
  user: one(authUser, {
    fields: [conversations.userId],
    references: [authUser.id],
  }),
  messages: many(messages),
}));

export const messageRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const linearIssueRelations = relations(linearIssues, ({ one }) => ({
  project: one(projects, {
    fields: [linearIssues.projectId],
    references: [projects.id],
  }),
}));

export const wikiDocumentRelations = relations(wikiDocuments, ({ one, many }) => ({
  project: one(projects, {
    fields: [wikiDocuments.projectId],
    references: [projects.id],
  }),
  chunks: many(wikiChunks),
}));

export const wikiChunkRelations = relations(wikiChunks, ({ one }) => ({
  document: one(wikiDocuments, {
    fields: [wikiChunks.documentId],
    references: [wikiDocuments.id],
  }),
}));

export const localTicketRelations = relations(localTickets, ({ one }) => ({
  project: one(projects, {
    fields: [localTickets.projectId],
    references: [projects.id],
  }),
  assignee: one(authUser, {
    fields: [localTickets.assigneeId],
    references: [authUser.id],
  }),
}));
