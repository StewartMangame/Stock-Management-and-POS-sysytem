import { NextRequest } from 'next/server';
import { runCronJob } from '@/server/services/cron-helper';
import { cleanupOldHeldSales } from '@/server/services/pos/held-sales';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/cleanup-held-sales
 * Purges abandoned held carts older than 24 hours.
 */
export async function GET(req: NextRequest) {
  return runCronJob('held_sale_cleanup', req, async () => {
    return await cleanupOldHeldSales(24);
  });
}

