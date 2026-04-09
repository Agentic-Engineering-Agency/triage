import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

const libsqlUrl = process.env.LIBSQL_URL || 'http://libsql:8080';

export const client = createClient({
  url: libsqlUrl,
});

export const db = drizzle(client, {
  schema,
  logger: process.env.NODE_ENV === 'development',
});
