import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 * Liveness probe: returns status only, no database connection or external calls.
 * Public endpoint for load balancers and platform health checks.
 */
export async function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}

