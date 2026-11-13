import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { db } from '@/server/db';
import { cronRuns } from '@/server/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Validates the Vercel Cron Bearer secret in constant time.
 * Returns true if the token is valid, false otherwise.
 */
export function verifyCronBearerSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;

  if (authHeader.length !== expected.length) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Wraps a scheduled cron execution with constant-time authentication,
 * heartbeat recording, timing, and error handling.
 */
export async function runCronJob<T>(
  jobName: string,
  req: Request,
  handler: () => Promise<T>,
): Promise<NextResponse> {
  // 1. Verify Bearer secret in constant time BEFORE any database work
  if (!verifyCronBearerSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  let runId: string | null = null;

  // 2. Record heartbeat start
  try {
    const [inserted] = await db
      .insert(cronRuns)
      .values({
        jobName,
        status: 'started',
        startedAt: new Date(startTime),
      })
      .returning({ id: cronRuns.id });
    runId = inserted?.id ?? null;
  } catch (err) {
    console.warn(`[cron:${jobName}] Failed to record start heartbeat:`, err);
  }

  // 3. Execute job handler
  try {
    const result = await handler();
    const durationMs = Date.now() - startTime;

    if (runId) {
      await db
        .update(cronRuns)
        .set({
          status: 'completed',
          completedAt: new Date(),
          durationMs,
          metadata: typeof result === 'object' && result !== null ? (result as any) : undefined,
        })
        .where(eq(cronRuns.id, runId))
        .catch((err) => console.warn(`[cron:${jobName}] Failed to update heartbeat:`, err));
    }

    return NextResponse.json({ ok: true, durationMs, result });
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    console.error(`[cron:${jobName}] Execution failed:`, err);

    if (runId) {
      await db
        .update(cronRuns)
        .set({
          status: 'failed',
          completedAt: new Date(),
          durationMs,
          errorMessage: err?.message || String(err),
        })
        .where(eq(cronRuns.id, runId))
        .catch(() => {});
    }

    return NextResponse.json(
      { error: 'Job execution failed', detail: err?.message || String(err) },
      { status: 500 },
    );
  }
}

