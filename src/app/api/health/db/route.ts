import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { db } from '@/server/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.HEALTH_CHECK_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;

  const headerVal = req.headers.get('x-health-check-secret');
  if (!headerVal || headerVal.length !== secret.length) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(headerVal), Buffer.from(secret));
  } catch {
    return false;
  }
}

/**
 * GET /api/health/db
 * Database readiness probe: checks DB connection with SELECT 1.
 * Protected by 'x-health-check-secret' header for uptime monitoring services.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ status: 'ok', db: 'connected' }, { status: 200 });
  } catch (err) {
    console.error('[health:db] Database check failed:', err);
    return NextResponse.json(
      { status: 'degraded', error: 'Database unavailable' },
      { status: 503 },
    );
  }
}

