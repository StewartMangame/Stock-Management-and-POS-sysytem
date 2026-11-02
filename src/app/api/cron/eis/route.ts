/**
 * GET /api/cron/eis
 * Protected — requires Bearer CRON_SECRET or x-cron-secret header.
 * Processes pending EIS outbox items in batches.
 */
import { NextRequest, NextResponse } from 'next/server';
import { processEisOutboxBatch } from '@/server/services/integrations/eis/queue';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET environment variable is not configured.' },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get('authorization');
  const customHeader = request.headers.get('x-cron-secret');
  if (authHeader !== `Bearer ${cronSecret}` && customHeader !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const batchSizeParam = request.nextUrl.searchParams.get('batchSize');
  const batchSize = batchSizeParam ? Math.min(parseInt(batchSizeParam, 10), 100) : 20;

  try {
    const result = await processEisOutboxBatch(batchSize);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[EIS cron] Fatal error:', err);
    return NextResponse.json({ error: 'EIS batch processing failed', detail: String(err) }, { status: 500 });
  }
}

