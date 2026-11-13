/**
 * Database-backed rate limiters for stateless serverless environments.
 *
 * Implements:
 *   1. DB-backed login rate limiter (5 failed attempts per IP per 15 minutes) using login_attempts.
 *   2. General DB-backed rate limiter using payment_link_rate_limits table (sliding bucket per key).
 */

import { db } from '@/server/db';
import { loginAttempts, paymentLinkRateLimits } from '@/server/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';

const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

/**
 * Returns true if the IP has exceeded the login rate limit (should block the attempt).
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
 */
export async function recordLoginAttempt(
  ip: string,
  email: string,
  success: boolean,
): Promise<void> {
  await db.insert(loginAttempts).values({ ip, email: email.toLowerCase(), success });
}

/**
 * General persistent database-backed rate limiter for public endpoints (payment links, webhooks, APIs).
 * Uses PostgreSQL ON CONFLICT DO UPDATE atomic increment.
 *
 * @param key Unique rate limiting key (e.g. `pay_ip:${ip}`, `webhook:${ip}`)
 * @param limit Maximum allowed requests within the time window
 * @param windowSeconds Duration of the rate limit bucket window in seconds
 */
export async function checkDbRateLimit(
  key: string,
  limit = 60,
  windowSeconds = 60,
): Promise<{ allowed: boolean; count: number; remaining: number }> {
  // Strip null bytes to prevent PostgreSQL UTF-8 encoding rejection
  const safeKey = key.replace(/\0/g, '');
  const now = new Date();
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  const [row] = await db
    .insert(paymentLinkRateLimits)
    .values({
      key: safeKey,
      windowStart,
      requestCount: 1,
    })
    .onConflictDoUpdate({
      target: [paymentLinkRateLimits.key, paymentLinkRateLimits.windowStart],
      set: {
        requestCount: sql`${paymentLinkRateLimits.requestCount} + 1`,
      },
    })
    .returning({ count: paymentLinkRateLimits.requestCount });

  const currentCount = row?.count ?? 1;
  const allowed = currentCount <= limit;
  const remaining = Math.max(0, limit - currentCount);

  return { allowed, count: currentCount, remaining };
}
