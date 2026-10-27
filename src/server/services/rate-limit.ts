/**
 * DB-backed login rate limiter.
 *
 * Limits: 5 failed attempts per IP within a 15-minute sliding window.
 * Successful logins do not count against the limit.
 *
 * Why DB-backed?  Vercel serverless functions are stateless, so in-memory
 * counters are lost between requests.  The login_attempts table is lightweight
 * and rows are purged by the cleanup job (or manually with: DELETE FROM
 * login_attempts WHERE at < NOW() - INTERVAL '1 day').
 */

import { db } from '@/server/db';
import { loginAttempts } from '@/server/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';

const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

/**
 * Returns true if the IP has exceeded the rate limit (should block the attempt).
 * Logs the blocked attempt for audit purposes.
 */
export async function checkLoginRateLimit(ip: string, email: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1_000);

  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.ip, ip),
        eq(loginAttempts.success, false),
        gte(loginAttempts.at, windowStart),
      ),
    );

  return (row?.count ?? 0) >= MAX_FAILED_ATTEMPTS;
}

/**
 * Records a login attempt in the audit table.
 * Called after every authorize check regardless of outcome.
 */
export async function recordLoginAttempt(
  ip: string,
  email: string,
  success: boolean,
): Promise<void> {
  await db.insert(loginAttempts).values({ ip, email: email.toLowerCase(), success });
}
