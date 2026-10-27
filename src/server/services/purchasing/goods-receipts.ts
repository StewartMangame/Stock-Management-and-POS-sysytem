import { db } from '@/server/db';
import {
  goodsReceipts,
  goodsReceiptItems,
  landedCosts,
  purchaseOrders,
  purchaseOrderItems,
  products,
  suppliers,
  locations,
} from '@/server/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { getNextDocNumber } from '@/server/services/sequences';
import {
  allocateLandedCostsLargestRemainder,
  convertSupplierToMwkMinor,
  roundHalfUp,
  toDecimalQty,
} from '@/lib/stock-math';
import { executeStockMovements } from '@/server/services/stock/stock-engine';
import { writeAuditLog } from '@/server/services/audit';
import Decimal from 'decimal.js';

export interface LandedCostInput {
  costType: 'freight' | 'duty' | 'clearing' | 'other';
  amount: string | number;
  currency?: string;
  exchangeRate?: string | number;
}

export interface GoodsReceiptItemInput {
  poItemId?: string | null;
  productId: string;
  receivedQty: string | number;
  unitCostSupplier: string | number;
  serialNumbers?: string[];
}

export interface GoodsReceiptInput {
  purchaseOrderId?: string | null;
  supplierId: string;
  locationId: string;
  receivedDate?: string;
  supplierInvoiceNumber?: string | null;
  currency?: string;
  exchangeRate?: string | number;
  notes?: string | null;
  items: GoodsReceiptItemInput[];
  landedCosts?: LandedCostInput[];
  /** Flag to confirm over-receipt if items exceed remaining PO ordered quantity */
  allowOverReceipt?: boolean;
}

export async function listGoodsReceipts(filters?: {
  supplierId?: string;
  locationId?: string;
  purchaseOrderId?: string;
}) {
  const conditions = [];
  if (filters?.supplierId) conditions.push(eq(goodsReceipts.supplierId, filters.supplierId));
  if (filters?.locationId) conditions.push(eq(goodsReceipts.locationId, filters.locationId));
  if (filters?.purchaseOrderId) conditions.push(eq(goodsReceipts.purchaseOrderId, filters.purchaseOrderId));

  return await db.query.goodsReceipts.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(goodsReceipts.createdAt)],
    with: {
      supplier: true,
      location: true,
      purchaseOrder: true,
      items: {
        with: { product: true },
      },
      landedCosts: true,
    },
  });
}

export async function getGoodsReceiptById(id: string) {
  return await db.query.goodsReceipts.findFirst({
    where: eq(goodsReceipts.id, id),
    with: {
      supplier: true,
      location: true,
      purchaseOrder: true,
      items: {
        with: { product: true },
      },
      landedCosts: true,
    },
  });
}

/**
 * Validates goods receipt items against PO items and flags over-receipt.
 */
export async function validateGoodsReceipt(input: GoodsReceiptInput): Promise<{
  hasOverReceipt: boolean;
  warnings: string[];
}> {
  const warnings: string[] = [];

  if (input.purchaseOrderId) {
    const poItems = await db.query.purchaseOrderItems.findMany({
      where: eq(purchaseOrderItems.purchaseOrderId, input.purchaseOrderId),
      with: { product: true },
    });

    const poItemMap = new Map(poItems.map((pi) => [pi.id, pi]));

    for (const item of input.items) {
      if (!item.poItemId) continue;
      const poItem = poItemMap.get(item.poItemId);
      if (!poItem) continue;

      const ordered = toDecimalQty(poItem.orderedQty);
      const previouslyReceived = toDecimalQty(poItem.receivedQty);
      const incoming = toDecimalQty(item.receivedQty);
      const totalAfter = previouslyReceived.plus(incoming);

      if (totalAfter.gt(ordered)) {
        warnings.push(
          `Over-receipt for "${poItem.product.name}": ordered ${ordered}, previously received ${previouslyReceived}, receiving ${incoming} (Total: ${totalAfter}, excess: ${totalAfter.minus(ordered)})`,
        );
      }
    }
  }

  return {
    hasOverReceipt: warnings.length > 0,
    warnings,
  };
}

/**
 * Creates a Goods Receipt, calculates landed cost shares, updates average costs,
 * records stock movements, captures serial numbers, and updates purchase order status.
 */
export async function createGoodsReceipt(input: GoodsReceiptInput, actorId?: string) {
  if (!input.items || input.items.length === 0) {
    throw new Error('A goods receipt must contain at least one line item.');
  }

  // Pre-flight over-receipt check
  const validation = await validateGoodsReceipt(input);
  if (validation.hasOverReceipt && !input.allowOverReceipt) {
    const err = new Error('Over-receipt detected against purchase order. Confirmation required.');
    (err as any).isOverReceiptWarning = true;
    (err as any).warnings = validation.warnings;
    throw err;
  }

  const exchangeRate = new Decimal(input.exchangeRate || 1);
  if (exchangeRate.lte(0)) throw new Error('Exchange rate must be positive.');

  const currency = (input.currency || 'MWK').toUpperCase();

  const [receipt] = await db.transaction(async (tx) => {
    const grnNumber = await getNextDocNumber(tx, 'goods_receipt', input.locationId);

    // ── 1. Calculate Base Item Totals ─────────────────────────────────────────
    const lineValuesMwk: number[] = [];
    const itemPreps = [];
    let totalItemsMwkMinor = 0;

    for (const it of input.items) {
      const qty = toDecimalQty(it.receivedQty);
      if (qty.lte(0)) throw new Error('Received quantity must be greater than zero.');

      const unitCostSup = new Decimal(it.unitCostSupplier);
      const unitCostMwk = convertSupplierToMwkMinor(unitCostSup, exchangeRate);
      const lineTotalMwk = roundHalfUp(qty.times(unitCostMwk));

      lineValuesMwk.push(lineTotalMwk);
      totalItemsMwkMinor += lineTotalMwk;

      itemPreps.push({
        ...it,
        qty,
        unitCostSup,
        unitCostMwk,
        lineTotalMwk,
      });
    }

    // ── 2. Process Landed Costs (Multi-Currency) ──────────────────────────────
    let totalLandedMwkMinor = 0;
    const landedCostPreps = [];

    if (input.landedCosts && input.landedCosts.length > 0) {
      for (const lc of input.landedCosts) {
        const amt = new Decimal(lc.amount);
        if (amt.lte(0)) continue;

        const rate = new Decimal(lc.exchangeRate || 1);
        const amtMwkMinor = convertSupplierToMwkMinor(amt, rate);
        totalLandedMwkMinor += amtMwkMinor;

        landedCostPreps.push({
          costType: lc.costType,
          amount: amt.toFixed(4),
          currency: (lc.currency || 'MWK').toUpperCase(),
          exchangeRate: rate.toFixed(6),
          amountMwkMinor: amtMwkMinor,
        });
      }
    }

    // ── 3. Share Landed Costs using Largest Remainder Method (Rule 3) ─────────
    const landedShares = allocateLandedCostsLargestRemainder(lineValuesMwk, totalLandedMwkMinor);

    // ── 4. Insert Goods Receipt Header ────────────────────────────────────────
    const [grn] = await tx
      .insert(goodsReceipts)
      .values({
        grnNumber,
        purchaseOrderId: input.purchaseOrderId || null,
        supplierId: input.supplierId,
        locationId: input.locationId,
        status: 'completed',
        supplierInvoiceNumber: input.supplierInvoiceNumber?.trim() || null,
        receivedDate: input.receivedDate || new Date().toISOString().split('T')[0]!,
        currency,
        exchangeRate: exchangeRate.toFixed(6),
        totalItemsMwkMinor,
        totalLandedMwkMinor,
        notes: input.notes?.trim() || null,
        createdBy: actorId ?? null,
      })
      .returning();

    // ── 5. Insert Landed Cost Records ─────────────────────────────────────────
    for (const lc of landedCostPreps) {
      await tx.insert(landedCosts).values({
        goodsReceiptId: grn!.id,
        costType: lc.costType,
        amount: lc.amount,
        currency: lc.currency,
        exchangeRate: lc.exchangeRate,
        amountMwkMinor: lc.amountMwkMinor,
      });
    }

    // ── 6. Insert Goods Receipt Items & Prepare Stock Movements ───────────────
    const movementItems = [];

    for (let i = 0; i < itemPreps.length; i++) {
      const it = itemPreps[i]!;
      const landedShare = landedShares[i] || 0;
      // Landed unit cost = base unit cost + (landedShare / receivedQty)
      const sharePerUnit = roundHalfUp(new Decimal(landedShare).dividedBy(it.qty));
      const landedUnitCostMinor = it.unitCostMwk + sharePerUnit;

      const [grnItem] = await tx
        .insert(goodsReceiptItems)
        .values({
          goodsReceiptId: grn!.id,
          poItemId: it.poItemId || null,
          productId: it.productId,
          receivedQty: it.qty.toFixed(3),
          unitCostSupplier: it.unitCostSup.toFixed(4),
          unitCostMwkMinor: it.unitCostMwk,
          landedCostShareMinor: landedShare,
          landedUnitCostMinor,
          lineTotalMwkMinor: it.lineTotalMwk + landedShare,
        })
        .returning();

      // Update PO item received quantity if linked to PO
      if (it.poItemId) {
        const [poItem] = await tx
          .select({ receivedQty: purchaseOrderItems.receivedQty })
          .from(purchaseOrderItems)
          .where(eq(purchaseOrderItems.id, it.poItemId));

        if (poItem) {
          const currentRec = toDecimalQty(poItem.receivedQty);
          const newRec = currentRec.plus(it.qty);
          await tx
            .update(purchaseOrderItems)
            .set({ receivedQty: newRec.toFixed(3) })
            .where(eq(purchaseOrderItems.id, it.poItemId));
        }
      }

      movementItems.push({
        productId: it.productId,
        locationId: input.locationId,
        quantity: it.qty,
        unitCostMinor: landedUnitCostMinor,
        movementType: 'purchase_receipt' as const,
        referenceType: 'goods_receipt' as const,
        referenceId: grn!.id,
        notes: `GRN: ${grnNumber}${input.supplierInvoiceNumber ? ` (Inv: ${input.supplierInvoiceNumber})` : ''}`,
        serialNumbers: it.serialNumbers,
      });
    }

    // ── 7. Execute Stock Movements under Global Lock Order (Rule 4 & Rule 2) ──
    await executeStockMovements(tx, movementItems, actorId);

    // ── 8. Update Purchase Order Status if applicable ─────────────────────────
    if (input.purchaseOrderId) {
      const allPoItems = await tx
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, input.purchaseOrderId));

      let allFullyReceived = true;
      let anyReceived = false;

      for (const pi of allPoItems) {
        const ord = toDecimalQty(pi.orderedQty);
        const rec = toDecimalQty(pi.receivedQty);
        if (rec.gt(0)) anyReceived = true;
        if (rec.lt(ord)) allFullyReceived = false;
      }

      const newPoStatus = allFullyReceived
        ? 'received'
        : anyReceived
          ? 'partially_received'
          : 'submitted';

      await tx
        .update(purchaseOrders)
        .set({ status: newPoStatus, updatedAt: new Date() })
        .where(eq(purchaseOrders.id, input.purchaseOrderId));
    }

    return [grn];
  });

  await writeAuditLog(db, {
    userId: actorId,
    action: 'goods_receipt.create',
    entityType: 'goods_receipt',
    entityId: receipt!.id,
    after: receipt,
  });

  return receipt!;
}
