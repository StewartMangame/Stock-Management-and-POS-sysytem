/**
 * Background Reservation Expiration Service.
 *
 * Implements:
 *   - Sweeping and releasing expired stock reservations
 *   - Decrementing stock_balances.reserved for unfulfilled quantities
 *   - Updating reservation status to 'released'
 *   - Updating quotation status to 'expired' if all held reservations expired
 */

import { db } from '@/server/db';
import {
  stockReservations,
  stockBalances,
  quotations,
  quotationLines,
} from '@/server/db/schema';
import { eq, and, sql, lt, inArray } from 'drizzle-orm';
import Decimal from 'decimal.js';

export async function expireOutdatedReservations(): Promise<{ releasedReservations: number }> {
  return await db.transaction(async (tx) => {
    // 1. Find all active reservations whose expires_at is in the past
    const expiredReservations = await tx
      .select()
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.status, 'active'),
          sql`${stockReservations.expiresAt} IS NOT NULL`,
          lt(stockReservations.expiresAt, new Date()),
        ),
      )
      .for('update');

    if (expiredReservations.length === 0) {
      return { releasedReservations: 0 };
    }

    const quotationIdsToCheck = new Set<string>();

    for (const res of expiredReservations) {
      const unfulfilled = new Decimal(res.reservedQty).minus(res.fulfilledQty);

      if (unfulfilled.greaterThan(0)) {
        // Lock stock balance and decrement reserved
        const [bal] = await tx
          .select()
          .from(stockBalances)
          .where(
            and(
              eq(stockBalances.productId, res.productId),
              eq(stockBalances.locationId, res.locationId),
            ),
          )
          .for('update');

        if (bal) {
          const newReserved = Decimal.max(0, new Decimal(bal.reserved).minus(unfulfilled));
          await tx
            .update(stockBalances)
            .set({
              reserved: newReserved.toFixed(3),
              updatedAt: new Date(),
            })
            .where(eq(stockBalances.id, bal.id));
        }
      }

      // Mark reservation as released (never delete)
      await tx
        .update(stockReservations)
        .set({
          status: 'released',
        })
        .where(eq(stockReservations.id, res.id));

      if (res.sourceDocumentType === 'quotation') {
        quotationIdsToCheck.add(res.sourceDocumentId);
      }
    }

    // Check if affected quotations have any remaining active reservations
    for (const qId of quotationIdsToCheck) {
      const remainingActive = await tx
        .select({ count: sql<string>`count(*)` })
        .from(stockReservations)
        .where(
          and(
            eq(stockReservations.sourceDocumentType, 'quotation'),
            eq(stockReservations.sourceDocumentId, qId),
            eq(stockReservations.status, 'active'),
          ),
        );

      if (parseInt(remainingActive[0]?.count ?? '0', 10) === 0) {
        await tx
          .update(quotations)
          .set({
            status: 'expired',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(quotations.id, qId),
              inArray(quotations.status, ['draft', 'sent', 'accepted']),
            ),
          );
      }
    }

    return { releasedReservations: expiredReservations.length };
  });
}
