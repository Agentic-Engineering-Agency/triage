import { createSelectSchema, createInsertSchema } from 'drizzle-zod';
import { authUser, authSession, authAccount, authVerification, wikiDocuments, wikiChunks, localTickets } from './schema';

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
