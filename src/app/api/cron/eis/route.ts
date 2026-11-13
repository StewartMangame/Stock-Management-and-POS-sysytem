import { NextRequest } from 'next/server';
import { runCronJob } from '@/server/services/cron-helper';
import { processEisOutboxBatch } from '@/server/services/integrations/eis/queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/eis
 * Processes pending EIS outbox items in batches.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const batchSizeParam = url.searchParams.get('batchSize');
  const batchSize = batchSizeParam ? Math.min(parseInt(batchSizeParam, 10), 100) : 20;

  return runCronJob('eis_worker', req, async () => {
    return await processEisOutboxBatch(batchSize);
  });
}
