import { NextRequest } from 'next/server';
import { runCronJob } from '@/server/services/cron-helper';
import { expireOutdatedReservations } from '@/server/services/sales/cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/expire-reservations
 * Sweeps expired stock reservations and marks stale quotes as expired.
 */
export async function GET(req: NextRequest) {
  return runCronJob('expire_reservations', req, async () => {
    return await expireOutdatedReservations();
  });
}
