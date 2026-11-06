/**
 * Drizzle ORM client — uses @neondatabase/serverless with the WebSocket Pool.
 *
 * Why WebSocket Pool and not the Neon HTTP driver?
 *   The HTTP driver does not support interactive transactions or SELECT ... FOR UPDATE.
 *   The WebSocket Pool does, making it safe for all stock, payment and concurrency logic.
 *
 * The globalThis singleton prevents creating too many pool connections
 * during Next.js hot-module replacement in development.
 */
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';

// Required for WebSocket support in Node.js environments (server actions, seed script, tests).
neonConfig.webSocketConstructor = ws;

declare global {
  // eslint-disable-next-line no-var
  var __neonPool: Pool | undefined;
}

const connectionString =
  (process.env.NODE_ENV === 'test' && (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST))
    ? (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST)
    : process.env.DATABASE_URL;

const pool: Pool =
  globalThis.__neonPool ??
  new Pool({
    connectionString,
    // Neon's serverless pool reuses connections efficiently across requests.
    max: 10,
  });

// Suppress unhandled error crashes from idle pool connections terminated by server
pool.on('error', (err) => {
  // Ignored or logged; Pool handles removing closed clients automatically
});

if (process.env.NODE_ENV !== 'production') {
  globalThis.__neonPool = pool;
}

export const db = drizzle({ client: pool, schema });

/** Re-export pool for raw SQL queries (migrations, seed) */
export { pool };

/** Transaction type — use this to type `tx` parameters in service functions. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
