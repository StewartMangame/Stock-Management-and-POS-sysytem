import { db } from '@/server/db';
import {
  stockCounts,
  stockCountItems,
  stockMovements,
  stockBalances,
  products,
  serialNumbers,
  locations,
} from '@/server/db/schema';
import { eq, desc, and, gte, inArray } from 'drizzle-orm';
import { getNextDocNumber } from '@/server/services/sequences';
import { executeStockMovements } from '@/server/services/stock/stock-engine';
import { writeAuditLog } from '@/server/services/audit';
import { roundHalfUp, toDecimalQty } from '@/lib/stock-math';
import Decimal from 'decimal.js';

export interface StockCountLineInput {
  productId: string;
  countedQty: string | number;
  missingSerialIds?: string[];
}

export interface StockCountInput {
  locationId: string;
  notes?: string | null;
  items?: StockCountLineInput[];
}

export async function listStockCounts(filters?: { locationId?: string; status?: string }) {
  const conditions = [];
  if (filters?.locationId) conditions.push(eq(stockCounts.locationId, filters.locationId));
  if (filters?.status) conditions.push(eq(stockCounts.status, filters.status));

  return await db.query.stockCounts.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(stockCounts.createdAt)],
    with: {
      location: true,
      items: {
        with: { product: true },
      },
      createdByUser: true,
      reconciledByUser: true,
    },
  });
}

export async function getStockCountById(id: string) {
  return await db.query.stockCounts.findFirst({
    where: eq(stockCounts.id, id),
    with: {
      location: true,
      items: {
        with: { product: true },
      },
      createdByUser: true,
      reconciledByUser: true,
    },
  });
}

export async function createStockCount(input: StockCountInput, actorId?: string) {
  const [created] = await db.transaction(async (tx) => {
    const countNumber = await getNextDocNumber(tx, 'stock_count', input.locationId);

    const [header] = await tx
      .insert(stockCounts)
      .values({
        countNumber,
        locationId: input.locationId,
        status: 'in_progress',
        countedAt: new Date(),
        notes: input.notes?.trim() || null,
        createdBy: actorId ?? null,
      })
      .returning();

    // If initial items provided, create lines
    if (input.items && input.items.length > 0) {
      for (const it of input.items) {
        const qty = toDecimalQty(it.countedQty);
        await tx.insert(stockCountItems).values({
          countId: header!.id,
          productId: it.productId,
          systemQty: '0', // will be evaluated at reconciliation time
          countedQty: qty.toFixed(3),
          varianceQty: '0',
          unitCostMinor: 0,
          varianceValueMinor: 0,
          missingSerialIds: it.missingSerialIds || null,
        });
      }
    } else {
      // Pre-populate with all active products at this location
      const balances = await tx.query.stockBalances.findMany({
        where: eq(stockBalances.locationId, input.locationId),
        with: { product: true },
      });

      for (const b of balances) {
        if (b.product.productType === 'service' || b.product.productType === 'non-inventory') continue;
        await tx.insert(stockCountItems).values({
          countId: header!.id,
          productId: b.productId,
          systemQty: b.onHand,
          countedQty: b.onHand,
          varianceQty: '0',
          unitCostMinor: Number(b.product.avgCostMinor),
          varianceValueMinor: 0,
        });
      }
    }

    return [header];
  });

  await writeAuditLog(db, {
    userId: actorId,
    action: 'stock_count.create',
    entityType: 'stock_count',
    entityId: created!.id,
    after: created,
  });

  return created!;
}

/**
 * Reconciles stock count under lock against CURRENT on-hand inventory.
 * Enforces:
 *   - Warning if movements occurred after count started
 *   - Missing serial selection for shortages of serial-tracked items
 */
export async function reconcileStockCount(
  id: string,
  lines: StockCountLineInput[],
  actorId?: string,
): Promise<{
  count: typeof stockCounts.$inferSelect;
  hasInterveningMovements: boolean;
  warningMessage?: string;
}> {
  const existing = await getStockCountById(id);
  if (!existing) throw new Error('Stock count not found');
  if (existing.status !== 'in_progress') {
    throw new Error(`Cannot reconcile stock count in '${existing.status}' status`);
  }

  let hasInterveningMovements = false;
  let warningMessage: string | undefined;

  const result = await db.transaction(async (tx) => {
    // ── Check if any movement happened since count was started ──────────────
    const recentMovements = await tx
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.locationId, existing.locationId),
          gte(stockMovements.occurredAt, existing.countedAt),
        ),
      )
      .limit(1);

    if (recentMovements.length > 0) {
      hasInterveningMovements = true;
      warningMessage =
        'Stock movements were recorded after this count began. Reconciliation was calculated against live inventory.';
    }

    // Clear existing count items and prepare new evaluated lines
    await tx.delete(stockCountItems).where(eq(stockCountItems.countId, id));

    const movementItems = [];

    for (const line of lines) {
      const counted = toDecimalQty(line.countedQty);
      if (counted.isNegative()) {
        throw new Error('Counted quantity cannot be negative.');
      }

      // Query product and balance under lock (or executeStockMovements handles lock ordering)
      const [prod] = await tx
        .select()
        .from(products)
        .where(eq(products.id, line.productId));
      if (!prod) throw new Error(`Product not found: ${line.productId}`);

      const [bal] = await tx
        .select()
        .from(stockBalances)
        .where(
          and(
            eq(stockBalances.productId, line.productId),
            eq(stockBalances.locationId, existing.locationId),
          ),
        );

      const systemQty = toDecimalQty(bal?.onHand ?? '0');
      const variance = counted.minus(systemQty);
      const unitCost = Number(prod.avgCostMinor);
      const varianceValueMinor = roundHalfUp(variance.abs().times(unitCost));

      // Handle serial-tracked shortages
      if (prod.serialTracking && variance.isNegative()) {
        const shortageCount = Math.abs(variance.toNumber());
        const missingIds = line.missingSerialIds || [];

        if (missingIds.length !== shortageCount) {
          throw new Error(
            `Shortage of ${shortageCount} unit(s) for "${prod.name}" requires selecting exactly ${shortageCount} missing serial number(s). Selected: ${missingIds.length}.`,
          );
        }

        // Mark missing serials as written_off
        await tx
          .update(serialNumbers)
          .set({ status: 'written_off', updatedAt: new Date(), locationId: null })
          .where(and(eq(serialNumbers.productId, prod.id), inArray(serialNumbers.id, missingIds)));
      }

      // Record item
      await tx.insert(stockCountItems).values({
        countId: id,
        productId: line.productId,
        systemQty: systemQty.toFixed(3),
        countedQty: counted.toFixed(3),
        varianceQty: variance.toFixed(3),
        unitCostMinor: unitCost,
        varianceValueMinor,
        missingSerialIds: line.missingSerialIds || null,
      });

      // If variance exists, create count_variance movement
      if (!variance.isZero()) {
        movementItems.push({
          productId: line.productId,
          locationId: existing.locationId,
          quantity: variance,
          unitCostMinor: unitCost,
          movementType: 'count_variance' as const,
          referenceType: 'stock_count' as const,
          referenceId: id,
          notes: `Count: ${existing.countNumber} (Var: ${variance})`,
        });
      }
    }

    // Execute atomic movements for variances
    if (movementItems.length > 0) {
      await executeStockMovements(tx, movementItems, actorId);
    }

    // Mark count as reconciled
    const [reconciled] = await tx
      .update(stockCounts)
      .set({
        status: 'reconciled',
        reconciledAt: new Date(),
        reconciledBy: actorId ?? null,
      })
      .where(eq(stockCounts.id, id))
      .returning();

    return reconciled!;
  });

  await writeAuditLog(db, {
    userId: actorId,
    action: 'stock_count.reconcile',
    entityType: 'stock_count',
    entityId: id,
    before: { status: 'in_progress' },
    after: { status: 'reconciled', hasInterveningMovements },
  });

  return {
    count: result,
    hasInterveningMovements,
    warningMessage,
  };
}
