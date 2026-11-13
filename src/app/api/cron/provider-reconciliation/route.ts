import { NextRequest } from 'next/server';
import { runCronJob } from '@/server/services/cron-helper';
import { reconcilePendingProviderPayments } from '@/server/services/integrations/provider-reconciliation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/provider-reconciliation
 * Sweeps pending mobile money and card transactions.
 */
export async function GET(req: NextRequest) {
  return runCronJob('provider_reconciliation', req, async () => {
    return await reconcilePendingProviderPayments(50);
  });
}

