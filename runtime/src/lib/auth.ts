import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { db } from '../db/client';
import { authUser, authSession, authAccount, authVerification } from '../db/schema';

const trustedOrigins = (() => {
  const origins: string[] = [];
  const devOrigin = process.env.BETTER_AUTH_URL || 'http://localhost:3001';
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.BETTER_AUTH_URL) {
      throw new Error('BETTER_AUTH_URL is required in production');
    }
    origins.push(process.env.BETTER_AUTH_URL);
  } else {
    origins.push(devOrigin);
  }
  return origins;
})();

export const auth = betterAuth({
  basePath: '/auth',
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema: {
      user: authUser,
      session: authSession,
      account: authAccount,
      verification: authVerification,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 0,
    cookie: {
      name: 'session',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    },
  },
  trustedOrigins,
  secret: process.env.NODE_ENV === 'production'
    ? (process.env.BETTER_AUTH_SECRET || (() => { throw new Error('BETTER_AUTH_SECRET is required in production'); })())
    : (process.env.BETTER_AUTH_SECRET || 'dev-secret-change-in-production-min32chars'),
});
