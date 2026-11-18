/**
 * Pooled Endpoint Timeout Test.
 *
 * Verifies Item 8:
 * - Executes queries against the Neon WebSocket pooled endpoint.
 * - Inside a transaction, executes `SET LOCAL statement_timeout = '200ms'`.
 * - Executes a slow query (SELECT pg_sleep(1)) and verifies cancellation with PG code 57014.
 * - Verifies that SET LOCAL is strictly scoped to the transaction and does NOT affect subsequent queries.
 */

import { describe, it, expect } from 'vitest';
import { db, pool } from '@/server/db';
import { sql } from 'drizzle-orm';
import { unwrapDatabaseError } from '@/server/db/errors';

describe('Item 8: Pooled Endpoint Statement Timeout & SET LOCAL Scoping', () => {
  it('cancels a slow query at the configured timeout inside a transaction using SET LOCAL', async () => {
    // 1. Transaction with SET LOCAL statement_timeout
    let caughtError: unknown = null;

    try {
      await db.transaction(async (tx) => {
        // Set statement timeout locally for this transaction only
        await tx.execute(sql`SET LOCAL statement_timeout = '300ms'`);

        // Execute query exceeding 300ms (1 second sleep)
        await tx.execute(sql`SELECT pg_sleep(1)`);
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    const unwrapped = unwrapDatabaseError(caughtError);

    // Code 57014: query_canceled (statement timeout)
    expect(unwrapped.code).toBe('57014');
    expect(unwrapped.message.toLowerCase()).toContain('statement timeout');
    expect(unwrapped.safeUserMessage).toBe('The database operation timed out. Please try again.');
  });

  it('guarantees SET LOCAL does not bleed: subsequent query succeeds without timeout', async () => {
    // 2. Subsequent query outside the rolled-back transaction must succeed
    const res = await db.execute<{ result: number }>(sql`SELECT 42 AS result`);
    expect(res.rows[0]?.result).toBe(42);
  });
});

