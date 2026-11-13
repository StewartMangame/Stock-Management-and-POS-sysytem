import { NextRequest } from 'next/server';
import { runCronJob } from '@/server/services/cron-helper';
import { runSnapshotCron } from '@/server/services/stock/snapshot-cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/stock-snapshot
 * Takes daily stock snapshots at 22:00 UTC (midnight Blantyre).
 */
export async function GET(req: NextRequest) {
  return runCronJob('stock_snapshot', req, async () => {
    return await runSnapshotCron();
  });
}
