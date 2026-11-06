/**
 * Quotations and Stock Reservation Service.
 *
 * Implements:
 *   - Quotation creation with automatic SKU/description snapshot
 *   - Gap-free sequential numbering on send
 *   - Acceptance with bundle component expansion and stock reservations
 *   - Deadlock-free global lock ordering
 *   - Reservation expiration and cancellation (rows never deleted)
 *   - Dynamic tax rate lookup from tax_rates table
 */

import { db, type DbTransaction } from '@/server/db';
import {
  quotations,
  quotationLines,
  customers,
  products,
  productBundles,
  stockBalances,
  stockReservations,
  taxRates,
  locations,
} from '@/server/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { calculateDocumentTotals } from '@/lib/sales-math';
import { getNextDocNumber } from '@/server/services/sequences';
import { getSetting } from '@/server/services/settings';
import { writeAuditLog } from '@/server/services/audit';
import Decimal from 'decimal.js';

export interface CreateQuotationLineInput {
  productId: string;
  quantity: number | string;
  unitPriceMinor: number;
  discountMinor?: number;
  taxRateId?: string;
  description?: string;
  notes?: string;
}

export interface CreateQuotationInput {
  customerId: string;
  locationId: string;
  quotationDate?: string;
  validUntil?: string;
  currency?: string;
  exchangeRate?: number | string;
  notes?: string;
  terms?: string;
  lines: CreateQuotationLineInput[];
}

export async function createQuotation(input: CreateQuotationInput, userId?: string) {
  if (!input.lines || input.lines.length === 0) {
    throw new Error('Quotation must contain at least one line');
  }

  // 1. Fetch default tax rate if not provided per line
  const [defaultTaxRate] = await db
    .select()
    .from(taxRates)
    .where(and(eq(taxRates.isDefault, true), eq(taxRates.isActive, true)));

  if (!defaultTaxRate) {
    throw new Error('Default tax rate not configured');
  }

  // 2. Fetch all products to copy SKU and description
  const productIds = input.lines.map((l) => l.productId);
  const fetchedProducts = await db
    .select()
    .from(products)
    .where(inArray(products.id, productIds));

  const productMap = new Map(fetchedProducts.map((p) => [p.id, p]));

  // 3. Fetch tax rates used
  const taxRateIds = Array.from(
    new Set(input.lines.map((l) => l.taxRateId || defaultTaxRate.id)),
  );
  const fetchedTaxRates = await db
    .select()
    .from(taxRates)
    .where(inArray(taxRates.id, taxRateIds));
  const taxRateMap = new Map(fetchedTaxRates.map((t) => [t.id, t]));

  // 4. Calculate lines using shared math
  const linesForMath = input.lines.map((l) => {
    const p = productMap.get(l.productId);
    if (!p) throw new Error(`Product ${l.productId} not found`);

    const t = taxRateMap.get(l.taxRateId || p.taxRateId || defaultTaxRate.id);
    if (!t) throw new Error(`Tax rate for product ${p.name} not found`);

    return {
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      discountMinor: l.discountMinor ?? 0,
      taxRateBasisPoints: t.rateBasisPoints,
      taxRateId: t.id,
      productId: p.id,
      sku: p.sku,
      description: l.description !== undefined ? l.description : (p.description ?? p.name),
      notes: l.notes,
    };
  });

  const totals = calculateDocumentTotals(linesForMath);

  // Default quotation valid days from settings
  const validDaysSetting = await getSetting('quotation_valid_days');
  const validDays = typeof validDaysSetting === 'number' ? validDaysSetting : 30;

  const quoteDate = input.quotationDate
    ? new Date(input.quotationDate)
    : new Date();
  const validUntilDate = input.validUntil
    ? new Date(input.validUntil)
    : new Date(quoteDate.getTime() + validDays * 24 * 60 * 60 * 1000);

  return await db.transaction(async (tx) => {
    const [quote] = await tx
      .insert(quotations)
      .values({
        customerId: input.customerId,
        locationId: input.locationId,
        status: 'draft',
        quotationDate: quoteDate.toISOString().split('T')[0]!,
        validUntil: validUntilDate.toISOString().split('T')[0]!,
        currency: (input.currency || 'MWK').toUpperCase(),
        exchangeRate: (input.exchangeRate || 1).toString(),
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        notes: input.notes,
        terms: input.terms,
        createdBy: userId,
      })
      .returning();

    for (let i = 0; i < linesForMath.length; i++) {
      const lineMeta = linesForMath[i]!;
      const calculatedLine = totals.lines[i]!;

      await tx.insert(quotationLines).values({
        quotationId: quote!.id,
        productId: lineMeta.productId,
        sku: lineMeta.sku,
        description: lineMeta.description,
        quantity: calculatedLine.quantity,
        unitPriceMinor: calculatedLine.unitPriceMinor,
        discountMinor: calculatedLine.discountMinor,
        taxRateId: lineMeta.taxRateId,
        taxRateBasisPoints: calculatedLine.taxRateBasisPoints,
        taxMinor: calculatedLine.taxMinor,
        lineTotalMinor: calculatedLine.lineTotalMinor,
        notes: lineMeta.notes,
      });
    }

    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'quotation_created',
        entityType: 'quotation',
        entityId: quote!.id,
        after: quote,
      });
    }

    return quote!;
  });
}

/**
 * Assigns a gap-free sequential quotation number and sets status to 'sent'.
 */
export async function sendQuotation(id: string, userId?: string) {
  return await db.transaction(async (tx) => {
    // Lock quotation row
    const [quote] = await tx
      .select()
      .from(quotations)
      .where(eq(quotations.id, id))
      .for('update');

    if (!quote) throw new Error('Quotation not found');
    if (quote.status !== 'draft') {
      throw new Error(`Cannot send quotation in status '${quote.status}'`);
    }

    // Generate gap-free quotation number in the same transaction
    const quoteNumber = await getNextDocNumber(tx, 'quotation', quote.locationId);

    const [updated] = await tx
      .update(quotations)
      .set({
        quotationNumber: quoteNumber,
        status: 'sent',
        updatedAt: new Date(),
      })
      .where(eq(quotations.id, id))
      .returning();

    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'quotation_sent',
        entityType: 'quotation',
        entityId: id,
        before: quote,
        after: updated,
      });
    }

    return updated!;
  });
}

/**
 * Accepts a quotation and reserves stock.
 *
 * Enforces deadlock-free lock order:
 * 1. Customer row
 * 2. Quotation row
 * 3. Product rows (ordered by product_id ASC)
 * 4. Stock balances (ordered by product_id ASC, location_id ASC)
 *
 * Bundle expansion:
 * A bundle line reserves its component products proportionally.
 */
export async function acceptQuotation(
  id: string,
  userId?: string,
  options?: { allowShortfallPartial?: boolean },
) {
  return await db.transaction(async (tx) => {
    // 1. Lock quotation header first to find customer and location
    const [quote] = await tx
      .select()
      .from(quotations)
      .where(eq(quotations.id, id))
      .for('update');

    if (!quote) throw new Error('Quotation not found');
    if (quote.status !== 'draft' && quote.status !== 'sent') {
      throw new Error(`Cannot accept quotation in status '${quote.status}'`);
    }

    // 2. Lock customer row (Rule 1 lock ordering)
    await tx
      .select()
      .from(customers)
      .where(eq(customers.id, quote.customerId))
      .for('update');

    // 3. Fetch lines
    const lines = await tx
      .select()
      .from(quotationLines)
      .where(eq(quotationLines.quotationId, id));

    // Determine all products that need reserving (expand bundles)
    const productIdsToReserve = new Set<string>();
    for (const line of lines) {
      productIdsToReserve.add(line.productId);
    }

    // Check which products are bundles
    const fetchedProds = await tx
      .select()
      .from(products)
      .where(inArray(products.id, Array.from(productIdsToReserve)));
    const prodMap = new Map(fetchedProds.map((p) => [p.id, p]));

    // Fetch bundle components
    const bundleProductIds = fetchedProds
      .filter((p) => p.productType === 'bundle')
      .map((p) => p.id);

    let bundleComponentsMap = new Map<string, Array<{ componentProductId: string; quantity: string }>>();
    if (bundleProductIds.length > 0) {
      const components = await tx
        .select()
        .from(productBundles)
        .where(inArray(productBundles.bundleProductId, bundleProductIds));

      for (const comp of components) {
        const list = bundleComponentsMap.get(comp.bundleProductId) || [];
        list.push({ componentProductId: comp.componentProductId, quantity: comp.quantity });
        bundleComponentsMap.set(comp.bundleProductId, list);
        productIdsToReserve.add(comp.componentProductId);
      }
    }

    // 3. Lock product rows ordered by ID ASC
    const sortedProductIds = Array.from(productIdsToReserve).sort();
    if (sortedProductIds.length > 0) {
      await tx
        .select()
        .from(products)
        .where(inArray(products.id, sortedProductIds))
        .orderBy(products.id)
        .for('update');
    }

    // 4. Lock stock balances ordered by product_id ASC, location_id ASC
    if (sortedProductIds.length > 0) {
      await tx
        .select()
        .from(stockBalances)
        .where(
          and(
            inArray(stockBalances.productId, sortedProductIds),
            eq(stockBalances.locationId, quote.locationId),
          ),
        )
        .orderBy(stockBalances.productId, stockBalances.locationId)
        .for('update');
    }

    // Calculate reservation hold expiration date
    const holdDaysSetting = await getSetting('reservation_hold_days');
    const holdDays = typeof holdDaysSetting === 'number' ? holdDaysSetting : 14;
    const expiresAt = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);

    // Reserve stock for each line
    for (const line of lines) {
      const prod = prodMap.get(line.productId);
      if (!prod || prod.productType === 'service') {
        continue; // Services don't require stock reservation
      }

      if (prod.productType === 'bundle') {
        // Expand bundle components and reserve each
        const components = bundleComponentsMap.get(prod.id) || [];
        for (const comp of components) {
          const compRequired = new Decimal(line.quantity).times(comp.quantity);

          await reserveStockForLine(tx, {
            productId: comp.componentProductId,
            locationId: quote.locationId,
            sourceDocumentType: 'quotation',
            sourceDocumentId: quote.id,
            sourceLineId: line.id,
            quantity: compRequired.toFixed(3),
            expiresAt,
            allowShortfallPartial: options?.allowShortfallPartial,
          });
        }
      } else {
        // Standard product
        await reserveStockForLine(tx, {
          productId: line.productId,
          locationId: quote.locationId,
          sourceDocumentType: 'quotation',
          sourceDocumentId: quote.id,
          sourceLineId: line.id,
          quantity: line.quantity,
          expiresAt,
          allowShortfallPartial: options?.allowShortfallPartial,
        });
      }
    }

    // Update quotation status to accepted
    const [updated] = await tx
      .update(quotations)
      .set({
        status: 'accepted',
        updatedAt: new Date(),
      })
      .where(eq(quotations.id, id))
      .returning();

    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'quotation_accepted',
        entityType: 'quotation',
        entityId: id,
        before: quote,
        after: updated,
      });
    }

    return updated!;
  });
}

/**
 * Cancels a quotation and releases all held stock reservations.
 */
export async function cancelQuotation(id: string, userId?: string) {
  return await db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(quotations)
      .where(eq(quotations.id, id))
      .for('update');

    if (!quote) throw new Error('Quotation not found');
    if (quote.status === 'converted' || quote.status === 'cancelled') {
      throw new Error(`Cannot cancel quotation in status '${quote.status}'`);
    }

    // Release all active reservations
    await releaseReservationsForDocument(tx, 'quotation', id);

    const [updated] = await tx
      .update(quotations)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(eq(quotations.id, id))
      .returning();

    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'quotation_cancelled',
        entityType: 'quotation',
        entityId: id,
        before: quote,
        after: updated,
      });
    }

    return updated!;
  });
}

// ── Internal Stock Reservation Helpers ────────────────────────────────────────

interface ReserveStockParams {
  productId: string;
  locationId: string;
  sourceDocumentType: 'quotation' | 'sales_document';
  sourceDocumentId: string;
  sourceLineId: string;
  quantity: string | number;
  expiresAt?: Date;
  allowShortfallPartial?: boolean;
}

export async function reserveStockForLine(tx: DbTransaction, params: ReserveStockParams) {
  const reqQty = new Decimal(params.quantity);
  if (reqQty.isZero() || reqQty.isNegative()) return;

  // Ensure balance row exists and lock it
  let [balance] = await tx
    .select()
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.productId, params.productId),
        eq(stockBalances.locationId, params.locationId),
      ),
    )
    .for('update');

  if (!balance) {
    const [created] = await tx
      .insert(stockBalances)
      .values({
        productId: params.productId,
        locationId: params.locationId,
        onHand: '0',
        reserved: '0',
      })
      .returning();
    balance = created!;
  }

  const onHand = new Decimal(balance.onHand);
  const currentReserved = new Decimal(balance.reserved);
  const available = onHand.minus(currentReserved);

  let reserveAmount = reqQty;

  if (available.lessThan(reqQty)) {
    if (!params.allowShortfallPartial) {
      throw new Error(
        `Insufficient available stock for product ${params.productId}. Available: ${available.toFixed(
          3,
        )}, Requested: ${reqQty.toFixed(3)}`,
      );
    }
    // Partial reservation allowed: reserve whatever available (or 0 if negative)
    reserveAmount = Decimal.max(0, available);
  }

  if (reserveAmount.greaterThan(0)) {
    // 1. Create reservation row (status: 'active', fulfilled_qty: '0')
    await tx.insert(stockReservations).values({
      productId: params.productId,
      locationId: params.locationId,
      sourceDocumentType: params.sourceDocumentType,
      sourceDocumentId: params.sourceDocumentId,
      sourceLineId: params.sourceLineId,
      reservedQty: reserveAmount.toFixed(3),
      fulfilledQty: '0',
      status: 'active',
      expiresAt: params.expiresAt,
    });

    // 2. Increment stock_balances.reserved
    const newReserved = currentReserved.plus(reserveAmount);
    await tx
      .update(stockBalances)
      .set({
        reserved: newReserved.toFixed(3),
        updatedAt: new Date(),
      })
      .where(eq(stockBalances.id, balance.id));
  }
}

/**
 * Releases all active stock reservations for a source document and decrements stock_balances.reserved.
 * Reservation rows are NEVER deleted; their status is set to 'released'.
 */
export async function releaseReservationsForDocument(
  tx: DbTransaction,
  sourceDocumentType: 'quotation' | 'sales_document',
  sourceDocumentId: string,
) {
  const activeReservations = await tx
    .select()
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.sourceDocumentType, sourceDocumentType),
        eq(stockReservations.sourceDocumentId, sourceDocumentId),
        eq(stockReservations.status, 'active'),
      ),
    );

  for (const res of activeReservations) {
    const unfulfilled = new Decimal(res.reservedQty).minus(res.fulfilledQty);

    if (unfulfilled.greaterThan(0)) {
      // Lock balance row and decrement
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

    // Mark reservation as released
    await tx
      .update(stockReservations)
      .set({ status: 'released' })
      .where(eq(stockReservations.id, res.id));
  }
}

/**
 * Extends the expiration date of active stock reservations on an accepted quotation.
 * Allows managers to extend the hold days.
 */
export async function extendQuotationReservationExpiry(
  quotationId: string,
  extraDays: number,
  userId?: string,
) {
  return await db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(quotations)
      .where(eq(quotations.id, quotationId))
      .for('update');

    if (!quote) throw new Error('Quotation not found');

    const activeReservations = await tx
      .select()
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.sourceDocumentType, 'quotation'),
          eq(stockReservations.sourceDocumentId, quotationId),
          eq(stockReservations.status, 'active'),
        ),
      );

    if (activeReservations.length === 0) {
      throw new Error('No active stock reservations found for this quotation');
    }

    const currentExpiry = activeReservations[0]?.expiresAt
      ? new Date(activeReservations[0].expiresAt).getTime()
      : Date.now();
    const newExpiresAt = new Date(currentExpiry + extraDays * 24 * 60 * 60 * 1000);

    await tx
      .update(stockReservations)
      .set({
        expiresAt: newExpiresAt,
      })
      .where(
        and(
          eq(stockReservations.sourceDocumentType, 'quotation'),
          eq(stockReservations.sourceDocumentId, quotationId),
          eq(stockReservations.status, 'active'),
        ),
      );

    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'quotation_reservation_extended',
        entityType: 'quotation',
        entityId: quotationId,
        after: {
          extraDays,
          newExpiresAt: newExpiresAt.toISOString(),
          reservationsUpdated: activeReservations.length,
        },
      });
    }

    return {
      success: true,
      newExpiresAt,
      reservationsUpdated: activeReservations.length,
    };
  });
}

