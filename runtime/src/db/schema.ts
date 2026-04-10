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

// ─── Wiki Tables ────────────────────────────────────────────────

export const wikiDocuments = sqliteTable('wiki_documents', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
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
  linearIssueId: text('linear_issue_id'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  severity: text('severity').notNull(),
  priority: integer('priority').notNull(),
  status: text('status').notNull().default('triage'),
  assigneeId: text('assignee_id').references(() => authUser.id),
  // project_id is managed at the raw-SQL layer in init-db.mjs because the
  // `projects` table itself is not a Drizzle entity (raw SQL in the same
  // file). We still declare the column here so:
  //   1. `drizzle-kit push` does not drop it as "unknown" on schema sync
  //   2. Drizzle queries expose it as a typed field
  //   3. The schema test's column allowlist passes for triage-workflow's
  //      raw-SQL INSERTs that write project_id
  // No .references() — the FK is enforced at the raw SQL layer, same
  // treatment as wikiDocuments.projectId above.
  projectId: text('project_id'),
  reporterEmail: text('reporter_email'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  syncedAt: integer('synced_at', { mode: 'timestamp' }),
});

// ─── Relations ──────────────────────────────────────────────────

export const authUserRelations = relations(authUser, ({ many }) => ({
  sessions: many(authSession),
  accounts: many(authAccount),
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

export const wikiDocumentRelations = relations(wikiDocuments, ({ many }) => ({
  chunks: many(wikiChunks),
}));

export const wikiChunkRelations = relations(wikiChunks, ({ one }) => ({
  document: one(wikiDocuments, {
    fields: [wikiChunks.documentId],
    references: [wikiDocuments.id],
  }),
}));

export const localTicketRelations = relations(localTickets, ({ one }) => ({
  assignee: one(authUser, {
    fields: [localTickets.assigneeId],
    references: [authUser.id],
  }),
}));
