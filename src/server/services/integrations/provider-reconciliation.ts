/**
 * Provider Payment Reconciliation Service.
 * Periodically sweeps pending provider transactions and updates status.
 */

import { db } from '@/server/db';
import { payments, paymentAttempts } from '@/server/db/schema';
import { eq, and, sql, lt, isNotNull } from 'drizzle-orm';
import { getPaymentProvider } from './onekhusa';

export async function reconcilePendingProviderPayments(limit = 25): Promise<{
  checked: number;
  updated: number;
}> {
  const provider = getPaymentProvider();

  // Find payments that are pending with a provider reference
  const pendingPayments = await db
    .select({
      id: payments.id,
      providerReference: payments.providerReference,
      status: payments.status,
    })
    .from(payments)
    .where(
      and(
        eq(payments.status, 'pending'),
        isNotNull(payments.providerReference),
      ),
    )
    .limit(limit);

  let updated = 0;

  for (const p of pendingPayments) {
    if (!p.providerReference) continue;

    try {
      const queryResult = await provider.queryTransaction(p.providerReference);

      if (queryResult.status === 'confirmed') {
        await db
          .update(payments)
          .set({
            status: 'confirmed',
            providerStatus: queryResult.status,
            updatedAt: new Date(),
          })
          .where(eq(payments.id, p.id));
        updated++;
      } else if (queryResult.status === 'failed' || queryResult.status === 'reversed') {
        await db
          .update(payments)
          .set({
            status: queryResult.status,
            providerStatus: queryResult.status,
            updatedAt: new Date(),
          })
          .where(eq(payments.id, p.id));
        updated++;
      }
    } catch (err) {
      console.warn(`[reconciliation] Failed to query ref '${p.providerReference}':`, err);
    }
  }

  return { checked: pendingPayments.length, updated };
}
