/**
 * Held Sales Service.
 *
 * Implements:
 *   - holdSale: saves cart to held_sales (no stock reservation, no sequence number burned)
 *   - listHeldSales: returns all held sales for a shift
 *   - recallHeldSale: retrieves cart, re-prices from product catalogue, flags changes
 *   - discardHeldSale: deletes a held sale record
 */

import { db } from '@/server/db';
import {
  heldSales,
  posShifts,
  products,
  stockBalances,
  customers,
  taxRates,
} from '@/server/db/schema';
import { eq, and, inArray, lt } from 'drizzle-orm';
import { writeAuditLog } from '@/server/services/audit';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CartLinePayload {
  productId: string;
  quantity: number;
  /** Price as it appeared in the cart (may differ from current product price). */
  unitPriceMinor: number;
  discountMinor?: number;
  serialNumbers?: string[];
  bundleComponentSerials?: Record<string, string[]>;
  notes?: string;
}

export interface HeldSaleCartPayload {
  lines: CartLinePayload[];
  customerId?: string;
  notes?: string;
  /** Any override approval metadata. */
  overrideApproval?: {
    approverId: string;
    action: string;
    reason: string;
  };
}

export interface HoldSaleInput {
  shiftId: string;
  holdReference: string;
  customerId?: string;
  cartPayload: HeldSaleCartPayload;
  userId: string;
}

export interface RecalledHeldSale {
  heldSale: typeof heldSales.$inferSelect;
  lines: Array<{
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    /** Current server price */
    currentUnitPriceMinor: number;
    /** Price when held */
    heldUnitPriceMinor: number;
    /** True if price changed since held */
    priceChanged: boolean;
    discountMinor: number;
    taxRateBasisPoints: number;
    serialNumbers?: string[];
    bundleComponentSerials?: Record<string, string[]>;
    /** True if there is insufficient stock at the location */
    stockInsufficient: boolean;
    availableQty: number;
    notes?: string;
  }>;
  hasWarnings: boolean;
}

// ── Service Functions ─────────────────────────────────────────────────────────

/**
 * Saves the current cart to held_sales.
 * Does NOT reserve stock or generate any document number.
 */
export async function holdSale(input: HoldSaleInput): Promise<typeof heldSales.$inferSelect> {
  // Verify shift is open
  const [shift] = await db
    .select({ id: posShifts.id, status: posShifts.status })
    .from(posShifts)
    .where(eq(posShifts.id, input.shiftId));

  if (!shift) throw new Error('Shift not found.');
  if (shift.status !== 'open') throw new Error('Cannot hold a sale on a closed shift.');

  const [held] = await db
    .insert(heldSales)
    .values({
      shiftId: input.shiftId,
      holdReference: input.holdReference,
      customerId: input.customerId ?? null,
      cartPayload: input.cartPayload as unknown as Record<string, unknown>,
      heldBy: input.userId,
    })
    .returning();

  await writeAuditLog(db, {
    userId: input.userId,
    action: 'pos.held_sale.created',
    entityType: 'held_sale',
    entityId: held!.id,
    after: { holdReference: input.holdReference, lineCount: input.cartPayload.lines.length },
  });

  return held!;
}

/**
 * Returns all held sales for a given shift.
 */
export async function listHeldSales(shiftId: string) {
  return db
    .select()
    .from(heldSales)
    .where(eq(heldSales.shiftId, shiftId))
    .orderBy(heldSales.heldAt);
}

/**
 * Recalls a held sale:
 *   1. Fetches the held sale record.
 *   2. Re-fetches current product prices and available stock at the shift's location.
 *   3. Flags price changes and stock shortages.
 *   4. Deletes the held sale record.
 *   5. Returns enriched line data for the caller to resume the cart.
 */
export async function recallHeldSale(
  heldSaleId: string,
  userId?: string,
): Promise<RecalledHeldSale> {
  const [held] = await db
    .select()
    .from(heldSales)
    .where(eq(heldSales.id, heldSaleId));

  if (!held) throw new Error('Held sale not found or already recalled.');

  // Get shift location
  const [shift] = await db
    .select({ locationId: posShifts.locationId, status: posShifts.status })
    .from(posShifts)
    .where(eq(posShifts.id, held.shiftId));

  if (!shift) throw new Error('Associated shift not found.');
  if (shift.status !== 'open') throw new Error('Associated shift is no longer open.');

  const payload = held.cartPayload as HeldSaleCartPayload;
  const productIds = [...new Set(payload.lines.map((l) => l.productId))];

  // Re-fetch current product data
  const currentProducts = await db
    .select()
    .from(products)
    .where(inArray(products.id, productIds));
  const prodMap = new Map(currentProducts.map((p) => [p.id, p]));

  // Fetch default tax rate
  const [defaultTaxRate] = await db
    .select()
    .from(taxRates)
    .where(and(eq(taxRates.isDefault, true), eq(taxRates.isActive, true)));

  // Fetch tax rates
  const taxRateIds = new Set<string>();
  for (const p of currentProducts) {
    if (p.taxRateId) taxRateIds.add(p.taxRateId);
  }
  const fetchedTaxRates = taxRateIds.size
    ? await db.select().from(taxRates).where(inArray(taxRates.id, [...taxRateIds]))
    : [];
  const taxRateMap = new Map([
    ...fetchedTaxRates.map((t) => [t.id, t] as [string, typeof t]),
    ...(defaultTaxRate ? [[defaultTaxRate.id, defaultTaxRate] as [string, typeof defaultTaxRate]] : []),
  ]);

  // Fetch current stock at location
  const stockBals = await db
    .select({ productId: stockBalances.productId, available: stockBalances.available })
    .from(stockBalances)
    .where(
      and(
        inArray(stockBalances.productId, productIds),
        eq(stockBalances.locationId, shift.locationId),
      ),
    );
  const stockMap = new Map(stockBals.map((b) => [b.productId, Number(b.available)]));

  let hasWarnings = false;

  const lines = payload.lines.map((line) => {
    const prod = prodMap.get(line.productId);
    if (!prod) {
      hasWarnings = true;
      return {
        productId: line.productId,
        productName: '[Product not found]',
        sku: '',
        quantity: line.quantity,
        currentUnitPriceMinor: 0,
        heldUnitPriceMinor: line.unitPriceMinor,
        priceChanged: true,
        discountMinor: line.discountMinor ?? 0,
        taxRateBasisPoints: 0,
        serialNumbers: line.serialNumbers,
        bundleComponentSerials: line.bundleComponentSerials,
        stockInsufficient: true,
        availableQty: 0,
        notes: line.notes,
      };
    }

    const taxRate = taxRateMap.get(prod.taxRateId ?? '') ?? defaultTaxRate;
    const currentPrice = prod.sellingPriceMinor > 0 ? prod.sellingPriceMinor : prod.avgCostMinor;
    const priceChanged = currentPrice !== line.unitPriceMinor;
    const available = stockMap.get(prod.id) ?? 0;
    const stockInsufficient =
      prod.productType !== 'service' && prod.productType !== 'non-inventory' && available < line.quantity;

    if (priceChanged || stockInsufficient) hasWarnings = true;

    return {
      productId: prod.id,
      productName: prod.name,
      sku: prod.sku,
      quantity: line.quantity,
      currentUnitPriceMinor: currentPrice,
      heldUnitPriceMinor: line.unitPriceMinor,
      priceChanged,
      discountMinor: line.discountMinor ?? 0,
      taxRateBasisPoints: taxRate?.rateBasisPoints ?? 0,
      serialNumbers: line.serialNumbers,
      bundleComponentSerials: line.bundleComponentSerials,
      stockInsufficient,
      availableQty: available,
      notes: line.notes,
    };
  });

  // Delete the held sale record (it's been recalled)
  await db.delete(heldSales).where(eq(heldSales.id, heldSaleId));

  if (userId) {
    await writeAuditLog(db, {
      userId,
      action: 'pos.held_sale.recalled',
      entityType: 'held_sale',
      entityId: heldSaleId,
      after: { holdReference: held.holdReference, hasWarnings },
    });
  }

  return { heldSale: held, lines, hasWarnings };
}

/**
 * Discards a held sale without resuming it.
 */
export async function discardHeldSale(heldSaleId: string, userId?: string): Promise<void> {
  const [held] = await db
    .select({ id: heldSales.id, holdReference: heldSales.holdReference })
    .from(heldSales)
    .where(eq(heldSales.id, heldSaleId));

  if (!held) throw new Error('Held sale not found.');

  await db.delete(heldSales).where(eq(heldSales.id, heldSaleId));

  if (userId) {
    await writeAuditLog(db, {
      userId,
      action: 'pos.held_sale.discarded',
      entityType: 'held_sale',
      entityId: heldSaleId,
      after: { holdReference: held.holdReference },
    });
  }
}

/**
 * Purges held sales older than the retention window (default 24 hours).
 */
export async function cleanupOldHeldSales(maxAgeHours = 24): Promise<{ purgedCount: number }> {
  const threshold = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const deleted = await db
    .delete(heldSales)
    .where(lt(heldSales.heldAt, threshold))
    .returning({ id: heldSales.id });

  return { purgedCount: deleted.length };
}
