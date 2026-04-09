import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';

const libsqlUrl = process.env.LIBSQL_URL || 'http://libsql:8080';

const client = createClient({
  url: libsqlUrl,
});

export const db = drizzle(client, {
  logger: process.env.NODE_ENV === 'development',
});
