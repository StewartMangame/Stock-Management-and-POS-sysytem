import { db } from '@/server/db';
import {
  stockAdjustments,
  stockAdjustmentItems,
  products,
  stockBalances,
  locations,
} from '@/server/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { getNextDocNumber } from '@/server/services/sequences';
import { executeStockMovements } from '@/server/services/stock/stock-engine';
import { writeAuditLog } from '@/server/services/audit';
import { roundHalfUp, toDecimalQty } from '@/lib/stock-math';
import Decimal from 'decimal.js';

export interface StockAdjustmentItemInput {
  productId: string;
  quantity: string | number;
  unitCostMinor?: number; // Required for IN adjustment if current on-hand is 0
  serialNumbers?: string[];
}

export interface StockAdjustmentInput {
  locationId: string;
  type: 'in' | 'out';
  reason: 'damaged' | 'expired' | 'internal_use' | 'found' | 'correction';
  notes?: string | null;
  items: StockAdjustmentItemInput[];
}

export async function listStockAdjustments(filters?: {
  locationId?: string;
  type?: string;
  reason?: string;
}) {
  const conditions = [];
  if (filters?.locationId) conditions.push(eq(stockAdjustments.locationId, filters.locationId));
  if (filters?.type) conditions.push(eq(stockAdjustments.type, filters.type));
  if (filters?.reason) conditions.push(eq(stockAdjustments.reason, filters.reason));

  return await db.query.stockAdjustments.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(stockAdjustments.createdAt)],
    with: {
      location: true,
      items: {
        with: { product: true },
      },
      createdByUser: true,
      approvedByUser: true,
    },
  });
}

export async function getStockAdjustmentById(id: string) {
  return await db.query.stockAdjustments.findFirst({
    where: eq(stockAdjustments.id, id),
    with: {
      location: true,
      items: {
        with: { product: true },
      },
      createdByUser: true,
      approvedByUser: true,
    },
  });
}

/**
 * Creates and executes a stock adjustment under global row lock ordering.
 * Enforces:
 *   - Adjustments out use current average cost
 *   - Adjustments in use current average cost, or require cost if on-hand is 0
 */
export async function createStockAdjustment(input: StockAdjustmentInput, actorId?: string) {
  if (!input.items || input.items.length === 0) {
    throw new Error('An adjustment must contain at least one product.');
  }

  const [adjustment] = await db.transaction(async (tx) => {
    const adjNumber = await getNextDocNumber(tx, 'stock_adjustment', input.locationId);

    const [header] = await tx
      .insert(stockAdjustments)
      .values({
        adjNumber,
        locationId: input.locationId,
        type: input.type,
        reason: input.reason,
        status: 'completed',
        notes: input.notes?.trim() || null,
        approvedBy: actorId ?? null,
        createdBy: actorId ?? null,
      })
      .returning();

    const movementItems = [];

    for (const item of input.items) {
      const rawQty = toDecimalQty(item.quantity).abs();
      if (rawQty.lte(0)) throw new Error('Adjustment quantity must be greater than zero.');

      // Query product and balance
      const [prod] = await tx
        .select()
        .from(products)
        .where(eq(products.id, item.productId));
      if (!prod) throw new Error(`Product not found: ${item.productId}`);

      const [bal] = await tx
        .select()
        .from(stockBalances)
        .where(
          and(
            eq(stockBalances.productId, item.productId),
            eq(stockBalances.locationId, input.locationId),
          ),
        );

      const currentOnHand = toDecimalQty(bal?.onHand ?? '0');
      let unitCost = Number(prod.avgCostMinor);

      if (input.type === 'in') {
        if (currentOnHand.lte(0)) {
          if (item.unitCostMinor === undefined || item.unitCostMinor <= 0) {
            throw new Error(
              `Unit cost is required for inward adjustment of "${prod.name}" because current on-hand is zero.`,
            );
          }
          unitCost = item.unitCostMinor;
        } else if (item.unitCostMinor && item.unitCostMinor > 0) {
          unitCost = item.unitCostMinor;
        }
      }

      const totalCostMinor = roundHalfUp(rawQty.times(unitCost));

      await tx.insert(stockAdjustmentItems).values({
        adjustmentId: header!.id,
        productId: item.productId,
        quantity: rawQty.toFixed(3),
        unitCostMinor: unitCost,
        totalCostMinor,
        serialNumbers: item.serialNumbers || null,
      });

      const movementQty = input.type === 'out' ? rawQty.negated() : rawQty;

      movementItems.push({
        productId: item.productId,
        locationId: input.locationId,
        quantity: movementQty,
        unitCostMinor: unitCost,
        movementType: 'adjustment' as const,
        referenceType: 'stock_adjustment' as const,
        referenceId: header!.id,
        notes: `Adj: ${adjNumber} (${input.reason})`,
        serialNumbers: item.serialNumbers,
      });
    }

    // Execute atomic movements
    await executeStockMovements(tx, movementItems, actorId);

    return [header];
  });

  await writeAuditLog(db, {
    userId: actorId,
    action: 'stock_adjustment.create',
    entityType: 'stock_adjustment',
    entityId: adjustment!.id,
    after: adjustment,
  });

  return adjustment!;
}
