/**
 * Core Stock Engine — executes all inventory mutations atomically under strict lock ordering.
 *
 * Implements:
 *   - Rule 4: Deadlock prevention — Product rows locked first (product_id ASC), then
 *             stock_balances rows locked (product_id ASC, location_id ASC).
 *   - Rule 10: Services (product_type = 'service') bypass movements and balances entirely.
 *   - Rule 2: Company-wide weighted average cost maintained on products.avg_cost_minor.
 *   - Rule 5: Immutable stock_movements ledger (append-only).
 *   - Rule 6: Rebuild and Check routines.
 */

import { eq, and, sql, asc } from 'drizzle-orm';
import type { db as DbType } from '@/server/db';
import {
  products,
  stockBalances,
  stockMovements,
  serialNumbers,
  locations,
  stockReservations,
} from '@/server/db/schema';
import { calcNewCompanyAverageCost, roundHalfUp, toDecimalQty } from '@/lib/stock-math';
import Decimal from 'decimal.js';

export interface MovementItem {
  productId: string;
  locationId: string;
  quantity: string | number | Decimal; // positive for IN, negative for OUT
  unitCostMinor?: number; // Landed unit cost in MWK tambala (required for receipts/inward movements)
  movementType:
    | 'opening'
    | 'purchase_receipt'
    | 'sale_delivery'
    | 'customer_return'
    | 'supplier_return'
    | 'adjustment'
    | 'count_variance'
    | 'transfer_in'
    | 'transfer_out';
  referenceType:
    | 'goods_receipt'
    | 'stock_adjustment'
    | 'stock_count'
    | 'opening_stock'
    | 'delivery_note'
    | 'credit_note';
  referenceId?: string;
  notes?: string;
  serialNumbers?: string[]; // Serials associated with this movement
  occurredAt?: Date;
}

export interface StockExecutionResult {
  movementsCount: number;
  productsUpdated: string[];
}

/**
 * Execute a batch of stock movements inside an existing transaction.
 *
 * Ensures strict global row-locking order:
 *   1. Product rows (ordered by product_id ASC)
 *   2. Stock balance rows (ordered by product_id ASC, location_id ASC)
 */
export async function executeStockMovements(
  tx: any,
  items: MovementItem[],
  actorId?: string | null,
): Promise<StockExecutionResult> {
  if (items.length === 0) {
    return { movementsCount: 0, productsUpdated: [] };
  }

  // ── Step 1: Collect and deduplicate unique Product IDs ────────────────────────
  const uniqueProductIds = Array.from(new Set(items.map((it) => it.productId))).sort();

  // Lock product rows in deterministic order (product_id ASC)
  const lockedProductsMap = new Map<string, typeof products.$inferSelect>();
  for (const pId of uniqueProductIds) {
    const [p] = await tx
      .select()
      .from(products)
      .where(eq(products.id, pId))
      .for('update');

    if (!p) {
      throw new Error(`Product not found: ${pId}`);
    }
    lockedProductsMap.set(pId, p);
  }

  // Filter out services (product_type === 'service' creates no movements or balance rows)
  const stockItems = items.filter((it) => {
    const prod = lockedProductsMap.get(it.productId);
    return prod && prod.productType !== 'service';
  });

  if (stockItems.length === 0) {
    return { movementsCount: 0, productsUpdated: [] };
  }

  // ── Step 2: Collect and deduplicate (product_id, location_id) pairs ───────────
  type ProdLocKey = `${string}:${string}`;
  const pairMap = new Map<ProdLocKey, { productId: string; locationId: string }>();

  for (const it of stockItems) {
    const key: ProdLocKey = `${it.productId}:${it.locationId}`;
    if (!pairMap.has(key)) {
      pairMap.set(key, { productId: it.productId, locationId: it.locationId });
    }
  }

  // Sort pairs deterministically: product_id ASC, then location_id ASC
  const sortedPairs = Array.from(pairMap.values()).sort((a, b) => {
    if (a.productId !== b.productId) return a.productId.localeCompare(b.productId);
    return a.locationId.localeCompare(b.locationId);
  });

  // Ensure balance rows exist for all pairs
  for (const pair of sortedPairs) {
    await tx
      .insert(stockBalances)
      .values({
        productId: pair.productId,
        locationId: pair.locationId,
        onHand: '0',
        reserved: '0',
      })
      .onConflictDoNothing();
  }

  // Lock stock_balances rows in deterministic order
  const lockedBalancesMap = new Map<ProdLocKey, typeof stockBalances.$inferSelect>();
  for (const pair of sortedPairs) {
    const [balance] = await tx
      .select()
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.productId, pair.productId),
          eq(stockBalances.locationId, pair.locationId),
        ),
      )
      .for('update');

    if (!balance) {
      throw new Error(`Failed to lock balance for product ${pair.productId} at location ${pair.locationId}`);
    }
    const key: ProdLocKey = `${pair.productId}:${pair.locationId}`;
    lockedBalancesMap.set(key, balance);
  }

  // ── Step 3: Apply movements ──────────────────────────────────────────────────
  const updatedProductIds = new Set<string>();

  for (const item of stockItems) {
    const prod = lockedProductsMap.get(item.productId)!;
    const balanceKey: ProdLocKey = `${item.productId}:${item.locationId}`;
    const balance = lockedBalancesMap.get(balanceKey)!;

    const qtyDecimal = toDecimalQty(item.quantity);
    if (qtyDecimal.isZero()) continue;

    const currentOnHand = toDecimalQty(balance.onHand);
    const newOnHand = currentOnHand.plus(qtyDecimal);

    // Prevent negative on_hand if reserved exists
    const reserved = toDecimalQty(balance.reserved);
    if (newOnHand.lt(reserved)) {
      throw new Error(
        `Insufficient stock for product "${prod.name}" (${prod.sku}) at this location. On hand: ${currentOnHand}, Reserved: ${reserved}, Requested change: ${qtyDecimal}`,
      );
    }

    // Determine unit cost for the ledger
    let unitCostMinor = item.unitCostMinor ?? 0;
    if (qtyDecimal.isNegative() && unitCostMinor === 0) {
      // Outward movements (sale, adjustment out) default to current average cost
      unitCostMinor = Number(prod.avgCostMinor);
    }

    const totalCostMinor = roundHalfUp(qtyDecimal.abs().times(unitCostMinor));

    // Append to immutable ledger
    const [movement] = await tx
      .insert(stockMovements)
      .values({
        productId: item.productId,
        locationId: item.locationId,
        movementType: item.movementType,
        quantity: qtyDecimal.toFixed(3),
        unitCostMinor,
        totalCostMinor,
        referenceType: item.referenceType,
        referenceId: item.referenceId ?? null,
        notes: item.notes ?? null,
        occurredAt: item.occurredAt ?? new Date(),
        createdBy: actorId ?? null,
      })
      .returning();

    // Update stock balance
    await tx
      .update(stockBalances)
      .set({
        onHand: newOnHand.toFixed(3),
        updatedAt: new Date(),
      })
      .where(eq(stockBalances.id, balance.id));

    // Update in-memory balance snapshot
    balance.onHand = newOnHand.toFixed(3);

    // ── Handle Serial Numbers if serial-tracked ─────────────────────────────
    if (prod.serialTracking && item.serialNumbers && item.serialNumbers.length > 0) {
      if (qtyDecimal.isPositive()) {
        // Enforce exactly 1 serial per integer unit received
        const intQty = qtyDecimal.toNumber();
        if (!Number.isInteger(intQty) || item.serialNumbers.length !== intQty) {
          throw new Error(
            `Serial count mismatch for "${prod.name}": received ${intQty} units but provided ${item.serialNumbers.length} serials.`,
          );
        }

        for (const rawSerial of item.serialNumbers) {
          const s = rawSerial.trim();
          if (!s) throw new Error('Serial number cannot be blank');

          // Check for existing serial with any status
          const existing = await tx
            .select()
            .from(serialNumbers)
            .where(
              and(
                eq(serialNumbers.productId, prod.id),
                sql`lower(${serialNumbers.serialNumber}) = lower(${s})`,
              ),
            )
            .limit(1);

          if (existing.length > 0) {
            throw new Error(`Duplicate serial number "${s}" already exists for product "${prod.name}".`);
          }

          let warrantyEnd: string | null = null;
          if (prod.warrantyMonths > 0) {
            const end = new Date();
            end.setMonth(end.getMonth() + prod.warrantyMonths);
            warrantyEnd = end.toISOString().split('T')[0]!;
          }

          await tx.insert(serialNumbers).values({
            productId: prod.id,
            serialNumber: s,
            status: 'in_stock',
            locationId: item.locationId,
            lastMovementId: movement?.id ?? null,
            warrantyStart: new Date().toISOString().split('T')[0]!,
            warrantyEnd,
          });
        }
      } else {
        // Outward serial movement
        for (const rawSerial of item.serialNumbers) {
          const s = rawSerial.trim();
          const targetStatus = item.movementType === 'sale_delivery' ? 'sold' : 'adjusted_out';

          const [matched] = await tx
            .select()
            .from(serialNumbers)
            .where(
              and(
                eq(serialNumbers.productId, prod.id),
                sql`lower(${serialNumbers.serialNumber}) = lower(${s})`,
                eq(serialNumbers.status, 'in_stock'),
              ),
            )
            .limit(1);

          if (!matched) {
            throw new Error(`Serial "${s}" is not currently in stock for product "${prod.name}".`);
          }

          await tx
            .update(serialNumbers)
            .set({
              status: targetStatus,
              lastMovementId: movement?.id ?? null,
              locationId: null,
              updatedAt: new Date(),
            })
            .where(eq(serialNumbers.id, matched.id));
        }
      }
    }

    // ── Update Company-Wide Average Cost on Receipts / Opening ──────────────
    if (qtyDecimal.isPositive() && (item.movementType === 'purchase_receipt' || item.movementType === 'opening')) {
      // Get company-wide total on-hand before this receipt was added
      // (Since we already added qtyDecimal to current location on-hand, subtract it from the total sum)
      const [sumRes] = await tx
        .select({ total: sql<string>`COALESCE(SUM(on_hand), 0)` })
        .from(stockBalances)
        .where(eq(stockBalances.productId, prod.id));

      const totalOnHandNow = toDecimalQty(sumRes?.total ?? '0');
      const totalOnHandBefore = totalOnHandNow.minus(qtyDecimal);

      const newAvgCost = calcNewCompanyAverageCost(
        totalOnHandBefore,
        prod.avgCostMinor,
        qtyDecimal,
        unitCostMinor,
      );

      await tx
        .update(products)
        .set({
          avgCostMinor: newAvgCost,
          lastCostMinor: unitCostMinor,
          updatedAt: new Date(),
        })
        .where(eq(products.id, prod.id));

      // Update in-memory product
      prod.avgCostMinor = newAvgCost;
      prod.lastCostMinor = unitCostMinor;
      updatedProductIds.add(prod.id);
    }
  }

  return {
    movementsCount: stockItems.length,
    productsUpdated: Array.from(updatedProductIds),
  };
}

/**
 * Recomputes all stock_balances and products.avg_cost_minor by replaying the entire
 * stock_movements ledger in chronological order (occurred_at ASC, seq ASC).
 */
export async function rebuildStockBalances(tx: any): Promise<{
  balancesUpdated: number;
  productsUpdated: number;
}> {
  // 1. Reset all stock balances to 0 on_hand and 0 reserved to satisfy CHECK (reserved <= on_hand)
  await tx.update(stockBalances).set({ onHand: '0', reserved: '0', updatedAt: new Date() });

  // 2. Reset products avg_cost_minor and last_cost_minor to 0
  await tx.update(products).set({ avgCostMinor: 0, lastCostMinor: 0, updatedAt: new Date() });

  // 3. Load active stock reservations
  const activeReservations = await tx
    .select({
      productId: stockReservations.productId,
      locationId: stockReservations.locationId,
      totalReserved: sql<string>`COALESCE(SUM(${stockReservations.reservedQty} - ${stockReservations.fulfilledQty}), 0)`,
    })
    .from(stockReservations)
    .where(eq(stockReservations.status, 'active'))
    .groupBy(stockReservations.productId, stockReservations.locationId);

  const reservationMap = new Map<string, string>();
  for (const r of activeReservations) {
    reservationMap.set(`${r.productId}:${r.locationId}`, r.totalReserved);
  }

  // 4. Load all movements in chronological order
  const movements = await tx
    .select()
    .from(stockMovements)
    .orderBy(asc(stockMovements.occurredAt), asc(stockMovements.seq));

  // In-memory simulation of company-wide on-hand and per-location on-hand
  // prodId -> { totalOnHand: Decimal, avgCost: number, lastCost: number }
  const productState = new Map<string, { totalOnHand: Decimal; avgCost: number; lastCost: number }>();
  // `${prodId}:${locId}` -> Decimal
  const balanceState = new Map<string, Decimal>();

  for (const m of movements) {
    const qty = toDecimalQty(m.quantity);
    const key = `${m.productId}:${m.locationId}`;

    const currentLoc = balanceState.get(key) ?? new Decimal(0);
    balanceState.set(key, currentLoc.plus(qty));

    let pState = productState.get(m.productId);
    if (!pState) {
      pState = { totalOnHand: new Decimal(0), avgCost: 0, lastCost: 0 };
      productState.set(m.productId, pState);
    }

    if (qty.isPositive() && (m.movementType === 'purchase_receipt' || m.movementType === 'opening')) {
      const newAvg = calcNewCompanyAverageCost(
        pState.totalOnHand,
        pState.avgCost,
        qty,
        m.unitCostMinor,
      );
      pState.avgCost = newAvg;
      pState.lastCost = m.unitCostMinor;
    }

    pState.totalOnHand = pState.totalOnHand.plus(qty);
  }

  // 5. Flush recomputed balances to DB via single bulk upsert
  const balanceEntries = Array.from(balanceState.entries());
  if (balanceEntries.length > 0) {
    const balanceValues = balanceEntries.map(([key, qty]) => {
      const [productId, locationId] = key.split(':') as [string, string];
      const reservedQty = reservationMap.get(key) || '0';
      return {
        productId,
        locationId,
        onHand: qty.toFixed(3),
        reserved: reservedQty,
        updatedAt: new Date(),
      };
    });

    await tx
      .insert(stockBalances)
      .values(balanceValues)
      .onConflictDoUpdate({
        target: [stockBalances.productId, stockBalances.locationId],
        set: {
          onHand: sql`excluded.on_hand`,
          reserved: sql`excluded.reserved`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  // 6. Flush recomputed product costs to DB
  const productEntries = Array.from(productState.entries());
  if (productEntries.length > 0) {
    const valueClauses = productEntries.map(
      ([productId, state]) =>
        sql`(${productId}::uuid, ${state.avgCost}::bigint, ${state.lastCost}::bigint)`
    );
    await tx.execute(sql`
      UPDATE products AS p
      SET
        avg_cost_minor = c.avg_cost_minor,
        last_cost_minor = c.last_cost_minor,
        updated_at = NOW()
      FROM (VALUES ${sql.join(valueClauses, sql`, `)}) AS c(id, avg_cost_minor, last_cost_minor)
      WHERE p.id = c.id;
    `);
  }

  return { balancesUpdated: balanceEntries.length, productsUpdated: productEntries.length };
}

/**
 * Checks consistency between stock_movements ledger and stock_balances.
 * Reports any mismatch in on_hand per (product_id, location_id).
 */
export async function checkStockLedgerConsistency(database: any): Promise<{
  isConsistent: boolean;
  discrepancies: Array<{
    productId: string;
    locationId: string;
    productName: string;
    locationName: string;
    balanceOnHand: string;
    ledgerSum: string;
    diff: string;
  }>;
}> {
  const query = sql`
    WITH ledger_totals AS (
      SELECT
        product_id,
        location_id,
        COALESCE(SUM(quantity), 0) AS ledger_qty
      FROM stock_movements
      GROUP BY product_id, location_id
    )
    SELECT
      sb.product_id,
      sb.location_id,
      p.name AS product_name,
      l.name AS location_name,
      sb.on_hand AS balance_on_hand,
      COALESCE(lt.ledger_qty, 0) AS ledger_sum,
      (sb.on_hand - COALESCE(lt.ledger_qty, 0)) AS diff
    FROM stock_balances sb
    JOIN products p ON p.id = sb.product_id
    JOIN locations l ON l.id = sb.location_id
    LEFT JOIN ledger_totals lt ON lt.product_id = sb.product_id AND lt.location_id = sb.location_id
    WHERE sb.on_hand != COALESCE(lt.ledger_qty, 0);
  `;

  const { rows } = await database.execute(query);
  const discrepancies = (rows as any[]).map((r) => ({
    productId: String(r.product_id),
    locationId: String(r.location_id),
    productName: String(r.product_name),
    locationName: String(r.location_name),
    balanceOnHand: String(r.balance_on_hand),
    ledgerSum: String(r.ledger_sum),
    diff: String(r.diff),
  }));

  return {
    isConsistent: discrepancies.length === 0,
    discrepancies,
  };
}
