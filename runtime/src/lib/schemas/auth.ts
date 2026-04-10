import { createSelectSchema, createInsertSchema } from 'drizzle-zod';
import { authUser, authSession, authAccount, authVerification } from '../../db/schema';

/**
 * Zod schemas for auth tables derived from Drizzle ORM.
 * Tables are prefixed with "auth_" to avoid conflict with Mastra's existing "account" table.
 */

export const authUserSelectSchema = createSelectSchema(authUser);
export const authUserInsertSchema = createInsertSchema(authUser);

export const authSessionSelectSchema = createSelectSchema(authSession);
export const authSessionInsertSchema = createInsertSchema(authSession);

export const authAccountSelectSchema = createSelectSchema(authAccount);
export const authAccountInsertSchema = createInsertSchema(authAccount);

export const authVerificationSelectSchema = createSelectSchema(authVerification);
export const authVerificationInsertSchema = createInsertSchema(authVerification);

// Aliases for convenience
export const userSchema = authUserSelectSchema;
export const sessionSchema = authSessionSelectSchema;
export const accountSchema = authAccountSelectSchema;
export const verificationSchema = authVerificationSelectSchema;
