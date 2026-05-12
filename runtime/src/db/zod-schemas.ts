import { createSelectSchema, createInsertSchema } from 'drizzle-zod';
// drizzle-zod 0.8 builds its output against zod v4's shape types, so the
// override overlay uses `zod/v4` explicitly. The rest of the codebase uses
// the v3 root export (`from 'zod'`) and those schemas work at runtime but
// clash structurally with the drizzle-zod v4 ZodObject shape.
import { z as zv4 } from 'zod/v4';
import {
  authUser,
  authSession,
  authAccount,
  authVerification,
  wikiDocuments,
  wikiChunks,
  localTickets,
  projectIntegrations,
} from './schema';

// Auth table schemas
export const authUserSelectSchema = createSelectSchema(authUser);
export const authUserInsertSchema = createInsertSchema(authUser);
export const authSessionSelectSchema = createSelectSchema(authSession);
export const authSessionInsertSchema = createInsertSchema(authSession);
export const authAccountSelectSchema = createSelectSchema(authAccount);
export const authAccountInsertSchema = createInsertSchema(authAccount);
export const authVerificationSelectSchema = createSelectSchema(authVerification);
export const authVerificationInsertSchema = createInsertSchema(authVerification);

// Wiki table schemas
export const wikiDocumentsSelectSchema = createSelectSchema(wikiDocuments);
export const wikiDocumentsInsertSchema = createInsertSchema(wikiDocuments);
export const wikiChunksSelectSchema = createSelectSchema(wikiChunks);
export const wikiChunksInsertSchema = createInsertSchema(wikiChunks);

// Local tickets schemas
export const localTicketsSelectSchema = createSelectSchema(localTickets);
export const localTicketsInsertSchema = createInsertSchema(localTickets);

// Project integrations schemas — BLOB + JSON + enum columns overlaid via
// .extend() with zod/v4 types (drizzle-zod's output shape is v4).
const projectIntegrationsOverrides = {
  provider: zv4.enum(['linear', 'resend', 'slack', 'github', 'openrouter']),
  status: zv4.enum(['active', 'disabled', 'invalid']),
  meta: zv4.record(zv4.string(), zv4.string()),
  encryptedKey: zv4.instanceof(Buffer),
};
export const projectIntegrationsSelectSchema = createSelectSchema(projectIntegrations).extend(
  projectIntegrationsOverrides,
);
export const projectIntegrationsInsertSchema = createInsertSchema(projectIntegrations).extend(
  projectIntegrationsOverrides,
);
