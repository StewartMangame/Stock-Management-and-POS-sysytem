/**
 * Counter Sale Service.
 *
 * Implements:
 *   - Server-side price/tax authority (client never sets price or tax rate)
 *   - Manager override for discounts and below-cost pricing
 *   - Single atomic db.transaction for: invoice, delivery note, stock movements, payments
 *   - Idempotency via sales_documents.idempotency_key (SHA-256 payload hash check)
 *   - Split payment support; sum must equal invoice total exactly
 *   - Cash change calculation stored in method_details
 *   - Walk-in customer default with credit block
 *   - Strict lock ordering to prevent deadlocks
 *   - Gap-free invoice and delivery note numbering
 */

import { db, type DbTransaction } from '@/server/db';
import {
  salesDocuments,
  salesDocumentLines,
  deliveryNotes,
  deliveryNoteLines,
  customers,
  products,
  productBundles,
  stockBalances,
  stockReservations,
  serialNumbers,
  taxRates,
  posShifts,
  payments,
  paymentAllocations,
} from '@/server/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { executeStockMovements } from '@/server/services/stock/stock-engine';
import { nextSequenceNumber } from '@/server/services/sequences';
import { writeAuditLog } from '@/server/services/audit';
import { calculateDocumentTotals } from '@/lib/sales-math';
import { recordPaymentWithTx } from '@/server/services/sales/payments';
import { verifyManagerOverride } from '@/server/services/pos/override';
import { getSetting } from '@/server/services/settings';
import { todayInCompanyTz, getNow } from '@/lib/timezone';
import Decimal from 'decimal.js';
import { createHash } from 'crypto';

// ── Input Types ───────────────────────────────────────────────────────────────

export interface CounterSaleLineInput {
  productId: string;
  quantity: number | string;
  /** If provided and differs from product price, requires managerOverridePin. */
  overriddenPriceMinor?: number;
  /** Line-level discount in tambala. Requires override if > 0. */
  discountMinor?: number;
  /** Serials for serial-tracked items. */
  serialNumbers?: string[];
  /** Component serials for bundle lines: { componentProductId: string[] } */
  bundleComponentSerials?: Record<string, string[]>;
  notes?: string;
}

export interface CounterSalePaymentInput {
  method: 'cash' | 'bank_transfer' | 'card' | 'airtel_money' | 'mpamba';
  /** Amount applied to this sale (must equal invoice total across all tender legs). */
  appliedMinor: number;
  /** For cash: amount actually tendered by customer (>= appliedMinor). */
  tenderedMinor?: number;
  methodDetails?: Record<string, unknown>;
  /** Optional pre-authorized payment in awaiting_sale status (e.g. mobile money prompt) */
  existingPaymentId?: string;
}

export interface CreateCounterSaleInput {
  idempotencyKey: string;
  shiftId: string;
  locationId: string;
  cashierId: string;
  /** Walk-in if omitted. */
  customerId?: string;
  lines: CounterSaleLineInput[];
  payments: CounterSalePaymentInput[];
  notes?: string;
  /** ISO timestamp from terminal clock (stored as client_created_at). */
  clientCreatedAt?: string;
  /** Manager override details — required if any line has a discounted/overridden price. */
  managerOverride?: {
    pin: string;
    reason: string;
  };
  /** Test hook: simulate catastrophic failure after writing payments to verify complete transaction rollback. */
  _testInjectFailureAfterPayments?: boolean;
}

export interface CounterSaleResult {
  invoice: typeof salesDocuments.$inferSelect;
  invoiceLines: (typeof salesDocumentLines.$inferSelect)[];
  deliveryNote: typeof deliveryNotes.$inferSelect;
  payments: Awaited<ReturnType<typeof recordPaymentWithTx>>[];
  changeMinor: number;
  isDuplicate?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashPayload(input: CreateCounterSaleInput): string {
  // Canonicalise the relevant payload fields to detect conflicts on the same idempotency key.
  const canon = JSON.stringify({
    shiftId: input.shiftId,
    locationId: input.locationId,
    cashierId: input.cashierId,
    customerId: input.customerId ?? null,
    lines: input.lines.map((l) => ({
      productId: l.productId,
      quantity: String(l.quantity),
      overriddenPriceMinor: l.overriddenPriceMinor ?? null,
      discountMinor: l.discountMinor ?? 0,
      serialNumbers: (l.serialNumbers ?? []).slice().sort(),
    })),
    payments: input.payments.map((p) => ({
      method: p.method,
      appliedMinor: p.appliedMinor,
    })),
  });
  return createHash('sha256').update(canon).digest('hex');
}

// ── Main Service ──────────────────────────────────────────────────────────────

/**
 * Creates a counter sale atomically.
 *
 * Idempotency: if idempotency_key already exists and the payload hash matches,
 * returns the existing sale. If hash differs, throws 409.
 *
 * Manager override: verified BEFORE the transaction so PIN lockout state is
 * consistently updated even if the transaction rolls back.
 */
export async function createCounterSale(
  input: CreateCounterSaleInput,
  userId?: string,
): Promise<CounterSaleResult> {
  const payloadHash = hashPayload(input);

  // ── 1. Pre-check idempotency (outside transaction — fast path) ───────────────
  const [existingDoc] = await db
    .select()
    .from(salesDocuments)
    .where(eq(salesDocuments.idempotencyKey, input.idempotencyKey));

  if (existingDoc) {
    // Verify payload hash stored in notes field (we embed it there) or just return
    if ((existingDoc.notes ?? '').includes(`[hash:${payloadHash}]`)) {
      // Fetch associated data for the full result
      const existingLines = await db
        .select()
        .from(salesDocumentLines)
        .where(eq(salesDocumentLines.documentId, existingDoc.id));
      const [existingDn] = await db
        .select()
        .from(deliveryNotes)
        .where(eq(deliveryNotes.salesDocumentId, existingDoc.id));
      return {
        invoice: existingDoc,
        invoiceLines: existingLines,
        deliveryNote: existingDn!,
        payments: [],
        changeMinor: 0,
        isDuplicate: true,
      };
    }
    throw Object.assign(
      new Error(`Idempotency key conflict: same key was used with a different payload.`),
      { statusCode: 409 },
    );
  }

  // ── 2. Verify manager override PIN (outside tx — updates lockout counters) ───
  let overrideApproverId: string | undefined;
  const linesNeedOverride = input.lines.some(
    (l) => (l.discountMinor ?? 0) > 0 || l.overriddenPriceMinor !== undefined,
  );

  if (linesNeedOverride) {
    if (!input.managerOverride) {
      throw new Error(
        'Manager override is required for discounted or overridden-price lines.',
      );
    }
    const overrideResult = await verifyManagerOverride({
      pin: input.managerOverride.pin,
      cashierUserId: input.cashierId,
      action: 'price_override',
      reason: input.managerOverride.reason,
    });
    overrideApproverId = overrideResult.approverId;
  }

  // ── 3. Fetch walk-in customer ID if not provided ─────────────────────────────
  let resolvedCustomerId = input.customerId;
  if (!resolvedCustomerId) {
    const [walkIn] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.isWalkIn, true));
    if (!walkIn) throw new Error('Walk-in customer not configured. Contact administrator.');
    resolvedCustomerId = walkIn.id;
  }

  // Fetch below-cost margin setting before opening transaction
  const maxDiscountSetting = await getSetting('max_discount_percent_without_approval');
  const minMarginPct = maxDiscountSetting ? Number(maxDiscountSetting) : 0;

  // ── 4. Atomic transaction ─────────────────────────────────────────────────────
  return await db.transaction(async (tx) => {
    // Lock ordering per plan:
    //   1. pos_shifts FOR SHARE
    //   2. customers FOR UPDATE
    //   3. products FOR UPDATE (sorted by id ASC)
    //   4. stock_balances FOR UPDATE (sorted by product_id ASC, location_id ASC)
    //   5. serial_numbers FOR UPDATE (sorted by id ASC)
    //   6. nextSequenceNumber (at end)

    // ── 4.1 Lock shift FOR SHARE ─────────────────────────────────────────────
    const [shift] = await tx
      .select()
      .from(posShifts)
      .where(eq(posShifts.id, input.shiftId))
      .for('share');

    if (!shift) throw new Error('Shift not found.');
    if (shift.status !== 'open') throw new Error(`Shift is not open (status: '${shift.status}').`);
    if (shift.locationId !== input.locationId) {
      throw new Error(
        `Shift location '${shift.locationId}' does not match sale location '${input.locationId}'.`,
      );
    }
    if (shift.cashierId !== input.cashierId) {
      throw new Error('Shift does not belong to the requesting cashier.');
    }

    // ── 4.2 Lock customer FOR UPDATE ─────────────────────────────────────────
    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, resolvedCustomerId!))
      .for('update');

    if (!customer) throw new Error('Customer not found.');
    if (!customer.isActive) throw new Error('Customer account is inactive.');

    // ── 4.3 Fetch default tax rate ───────────────────────────────────────────
    const [defaultTaxRate] = await tx
      .select()
      .from(taxRates)
      .where(and(eq(taxRates.isDefault, true), eq(taxRates.isActive, true)));
    if (!defaultTaxRate) throw new Error('Default tax rate is not configured.');

    // ── 4.4 Fetch & lock products (sorted by id ASC) ─────────────────────────
    const productIds = [...new Set(input.lines.map((l) => l.productId))].sort();

    // For bundle products, we need component product IDs too
    const initialProducts = await tx
      .select()
      .from(products)
      .where(inArray(products.id, productIds))
      .orderBy(products.id)
      .for('update');

    const initialProdMap = new Map(initialProducts.map((p) => [p.id, p]));

    // Check all product IDs exist
    for (const pid of productIds) {
      if (!initialProdMap.has(pid)) throw new Error(`Product ${pid} not found.`);
    }

    // Fetch bundle components
    const bundleProductIds = initialProducts
      .filter((p) => p.productType === 'bundle')
      .map((p) => p.id);

    const bundleComponentsMap = new Map<string, { componentProductId: string; quantity: string }[]>();
    const allProductIds = new Set<string>(productIds);

    if (bundleProductIds.length > 0) {
      const components = await tx
        .select()
        .from(productBundles)
        .where(inArray(productBundles.bundleProductId, bundleProductIds));

      for (const comp of components) {
        const list = bundleComponentsMap.get(comp.bundleProductId) ?? [];
        list.push({ componentProductId: comp.componentProductId, quantity: comp.quantity });
        bundleComponentsMap.set(comp.bundleProductId, list);
        allProductIds.add(comp.componentProductId);
      }
    }

    // Lock ALL product rows (including bundle components) in id ASC order
    const sortedAllProductIds = [...allProductIds].sort();
    const lockedProducts = await tx
      .select()
      .from(products)
      .where(inArray(products.id, sortedAllProductIds))
      .orderBy(products.id)
      .for('update');

    const lockedProdMap = new Map(lockedProducts.map((p) => [p.id, p]));

    // ── 4.5 Resolve server-side prices, validate overrides ───────────────────
    const resolvedLines: Array<{
      lineInput: CounterSaleLineInput;
      product: typeof products.$inferSelect;
      taxRate: typeof taxRates.$inferSelect;
      unitPriceMinor: number;
      discountMinor: number;
      priceIsOverridden: boolean;
    }> = [];

    // Fetch all needed tax rates
    const taxRateIds = new Set<string>();
    for (const prod of lockedProducts) {
      if (prod.taxRateId) taxRateIds.add(prod.taxRateId);
    }
    const fetchedTaxRates = taxRateIds.size
      ? await tx.select().from(taxRates).where(inArray(taxRates.id, [...taxRateIds]))
      : [];
    const taxRateMap = new Map([
      ...fetchedTaxRates.map((t) => [t.id, t] as [string, typeof t]),
      [defaultTaxRate.id, defaultTaxRate],
    ]);

    for (const lineInput of input.lines) {
      const prod = lockedProdMap.get(lineInput.productId);
      if (!prod) throw new Error(`Product ${lineInput.productId} not found.`);
      if (!prod.isActive) throw new Error(`Product '${prod.name}' is inactive.`);

      const taxRate = taxRateMap.get(prod.taxRateId ?? defaultTaxRate.id) ?? defaultTaxRate;
      const serverPrice = prod.sellingPriceMinor > 0 ? prod.sellingPriceMinor : prod.avgCostMinor;
      let unitPriceMinor = serverPrice;
      let priceIsOverridden = false;

      if (
        lineInput.overriddenPriceMinor !== undefined &&
        lineInput.overriddenPriceMinor !== serverPrice
      ) {
        if (!overrideApproverId) {
          throw new Error(
            `Price override for product '${prod.name}' requires manager approval. Provide managerOverride.`,
          );
        }
        unitPriceMinor = lineInput.overriddenPriceMinor;
        priceIsOverridden = true;
      }

      const discountMinor = lineInput.discountMinor ?? 0;
      if (discountMinor > 0 && !overrideApproverId) {
        throw new Error(
          `Discount on '${prod.name}' requires manager approval. Provide managerOverride.`,
        );
      }

      // Below-cost check
      if (minMarginPct > 0 && prod.avgCostMinor > 0) {
        const netPriceAfterDiscount = unitPriceMinor - discountMinor / Number(lineInput.quantity);
        const minPrice = prod.avgCostMinor * (1 + minMarginPct / 100);
        if (netPriceAfterDiscount < minPrice && !overrideApproverId) {
          throw new Error(
            `Price for '${prod.name}' is below minimum margin. Manager override required.`,
          );
        }
      }

      resolvedLines.push({ lineInput, product: prod, taxRate, unitPriceMinor, discountMinor, priceIsOverridden });
    }

    // ── 4.6 Calculate document totals ────────────────────────────────────────
    const linesForMath = resolvedLines.map(({ lineInput, product, taxRate, unitPriceMinor, discountMinor }) => ({
      quantity: lineInput.quantity,
      unitPriceMinor,
      discountMinor,
      taxRateBasisPoints: taxRate.rateBasisPoints,
      taxRateId: taxRate.id,
      productId: product.id,
      sku: product.sku,
      description: product.description ?? product.name,
      notes: lineInput.notes,
    }));

    const totals = calculateDocumentTotals(linesForMath);

    // ── 4.7 Validate payment split ───────────────────────────────────────────
    const totalApplied = input.payments.reduce((sum, p) => sum + p.appliedMinor, 0);
    if (totalApplied !== totals.totalMinor) {
      throw new Error(
        `Payment applied amounts (${totalApplied}) do not equal invoice total (${totals.totalMinor}).`,
      );
    }

    // Validate cash overpayment and calculate change
    let totalChangeMinor = 0;
    for (const pmt of input.payments) {
      if (pmt.method !== 'cash') {
        if (pmt.tenderedMinor !== undefined && pmt.tenderedMinor !== pmt.appliedMinor) {
          throw new Error(`Non-cash payments cannot be over-tendered (method: ${pmt.method}).`);
        }
      } else {
        const tendered = pmt.tenderedMinor ?? pmt.appliedMinor;
        if (tendered < pmt.appliedMinor) {
          throw new Error('Cash tendered cannot be less than amount applied.');
        }
        totalChangeMinor += tendered - pmt.appliedMinor;
      }
    }

    // ── 4.8 Lock stock balances FOR UPDATE (sorted by product_id, location_id) ──
    await tx
      .select()
      .from(stockBalances)
      .where(
        and(
          inArray(stockBalances.productId, sortedAllProductIds),
          eq(stockBalances.locationId, input.locationId),
        ),
      )
      .orderBy(stockBalances.productId, stockBalances.locationId)
      .for('update');

    // Check available stock for each non-bundle, non-service line
    for (const { lineInput, product } of resolvedLines) {
      if (product.productType === 'service' || product.productType === 'non-inventory') continue;
      if (product.productType === 'bundle') {
        // Check component stock
        const components = bundleComponentsMap.get(product.id) ?? [];
        for (const comp of components) {
          const compProd = lockedProdMap.get(comp.componentProductId);
          if (!compProd || compProd.productType === 'service' || compProd.productType === 'non-inventory') continue;
          const compQty = new Decimal(lineInput.quantity).times(comp.quantity);
          const [bal] = await tx
            .select({ available: stockBalances.available })
            .from(stockBalances)
            .where(
              and(
                eq(stockBalances.productId, comp.componentProductId),
                eq(stockBalances.locationId, input.locationId),
              ),
            );
          const available = new Decimal(bal?.available ?? '0');
          if (available.lessThan(compQty)) {
            throw new Error(
              `Insufficient stock for bundle component '${compProd.name}': available ${available.toFixed(3)}, required ${compQty.toFixed(3)}.`,
            );
          }
        }
      } else {
        const [bal] = await tx
          .select({ available: stockBalances.available })
          .from(stockBalances)
          .where(
            and(
              eq(stockBalances.productId, product.id),
              eq(stockBalances.locationId, input.locationId),
            ),
          );
        const available = new Decimal(bal?.available ?? '0');
        const requested = new Decimal(lineInput.quantity);
        if (available.lessThan(requested)) {
          throw new Error(
            `Insufficient stock for '${product.name}': available ${available.toFixed(3)}, required ${requested.toFixed(3)}.`,
          );
        }
      }
    }

    // ── 4.9 Lock serials FOR UPDATE (sorted by id ASC) ─────────────────────
    const serialsToLock: string[] = [];
    for (const { lineInput } of resolvedLines) {
      if (lineInput.serialNumbers) serialsToLock.push(...lineInput.serialNumbers);
      if (lineInput.bundleComponentSerials) {
        for (const sns of Object.values(lineInput.bundleComponentSerials)) {
          serialsToLock.push(...sns);
        }
      }
    }

    const lockedSerialsMap = new Map<string, typeof serialNumbers.$inferSelect>();
    if (serialsToLock.length > 0) {
      const uniqueSerials = [...new Set(serialsToLock)];
      const found = await tx
        .select()
        .from(serialNumbers)
        .where(
          and(
            inArray(serialNumbers.serialNumber, uniqueSerials),
            eq(serialNumbers.locationId, input.locationId),
          ),
        )
        .orderBy(serialNumbers.id)
        .for('update');

      for (const s of found) {
        lockedSerialsMap.set(s.serialNumber.toLowerCase(), s);
      }

      // Validate serials
      for (const { lineInput, product } of resolvedLines) {
        if (product.serialTracking && product.productType !== 'bundle') {
          const lineSerials = lineInput.serialNumbers ?? [];
          const qty = Number(lineInput.quantity);
          if (lineSerials.length !== qty) {
            throw new Error(
              `Product '${product.name}' requires exactly ${qty} serial number(s), got ${lineSerials.length}.`,
            );
          }
          for (const sn of lineSerials) {
            const row = lockedSerialsMap.get(sn.toLowerCase());
            if (!row || row.status !== 'in_stock' || row.productId !== product.id) {
              throw new Error(
                `Serial '${sn}' is not in stock at this location for product '${product.name}'.`,
              );
            }
          }
        }
        // Bundle component serials validated per component below
      }
    }

    // ── 4.10 Generate gap-free document numbers ───────────────────────────────
    const today = todayInCompanyTz();
    const invoiceNumber = await nextSequenceNumber(tx, 'invoice', input.locationId);
    const deliveryNumber = await nextSequenceNumber(tx, 'delivery_note', input.locationId);

    // ── 4.11 Insert sales_documents (issued, delivered, paid) ────────────────
    const noteWithHash = `[hash:${payloadHash}]${input.notes ? ' ' + input.notes : ''}`;

    const [invoice] = await tx
      .insert(salesDocuments)
      .values({
        documentType: 'invoice',
        documentNumber: invoiceNumber,
        customerId: resolvedCustomerId!,
        locationId: input.locationId,
        status: 'draft',
        deliveryStatus: 'delivered',
        paymentStatus: 'unpaid',
        issueDate: today,
        dueDate: today,
        currency: 'MWK',
        exchangeRate: '1.000000',
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        creditedMinor: 0,
        paidMinor: 0,
        balanceMinor: totals.totalMinor,
        isImmutable: false,
        notes: noteWithHash,
        channel: 'counter',
        shiftId: input.shiftId,
        idempotencyKey: input.idempotencyKey,
        clientCreatedAt: input.clientCreatedAt ? new Date(input.clientCreatedAt) : undefined,
        eisStatus: 'not_required',
        createdBy: userId,
      })
      .returning();

    // ── 4.12 Insert sales_document_lines ────────────────────────────────────
    const insertedLines: (typeof salesDocumentLines.$inferSelect)[] = [];
    for (let i = 0; i < resolvedLines.length; i++) {
      const { lineInput, product, taxRate, unitPriceMinor, discountMinor } = resolvedLines[i]!;
      const calcLine = totals.lines[i]!;

      const [insertedLine] = await tx
        .insert(salesDocumentLines)
        .values({
          documentId: invoice!.id,
          productId: product.id,
          sku: product.sku,
          description: product.description ?? product.name,
          quantity: calcLine.quantity,
          unitPriceMinor,
          discountMinor,
          taxRateId: taxRate.id,
          taxRateBasisPoints: calcLine.taxRateBasisPoints,
          taxMinor: calcLine.taxMinor,
          lineTotalMinor: calcLine.lineTotalMinor,
          deliveredQty: calcLine.quantity, // delivered immediately
          creditedQty: '0',
          unitCostMinor: product.avgCostMinor,
          returnGoods: false,
          notes: lineInput.notes,
        })
        .returning();

      insertedLines.push(insertedLine!);
    }

    // ── 4.12b Transition invoice to 'issued' and immutable ────────────────────
    const [finalInvoice] = await tx
      .update(salesDocuments)
      .set({
        status: 'issued',
        isImmutable: true,
        updatedAt: getNow(),
      })
      .where(eq(salesDocuments.id, invoice!.id))
      .returning();

    // ── 4.13 Insert delivery note ─────────────────────────────────────────────
    const [deliveryNote] = await tx
      .insert(deliveryNotes)
      .values({
        deliveryNumber,
        salesDocumentId: invoice!.id,
        locationId: input.locationId,
        customerId: resolvedCustomerId!,
        deliveryDate: today,
        status: 'dispatched',
        notes: `Counter sale — ${invoiceNumber}`,
        createdBy: userId,
      })
      .returning();

    // ── 4.14 Execute stock movements & insert delivery note lines ─────────────
    const movementsToExecute: Parameters<typeof executeStockMovements>[1] = [];

    for (let i = 0; i < resolvedLines.length; i++) {
      const { lineInput, product } = resolvedLines[i]!;
      const invLine = insertedLines[i]!;
      const requestedQty = new Decimal(lineInput.quantity);

      if (product.productType === 'service' || product.productType === 'non-inventory') {
        // No stock movement for services or non-inventory items
        await tx.insert(deliveryNoteLines).values({
          deliveryNoteId: deliveryNote!.id,
          salesDocumentLineId: invLine.id,
          productId: product.id,
          quantity: requestedQty.toFixed(3),
          unitCostMinor: 0,
          totalCostMinor: 0,
          isBundleComponent: false,
          serialNumbers: null,
        });
        continue;
      }

      if (product.productType === 'bundle') {
        const components = bundleComponentsMap.get(product.id) ?? [];
        for (const comp of components) {
          const compProd = lockedProdMap.get(comp.componentProductId)!;
          const compQty = requestedQty.times(comp.quantity);
          const compSerials = lineInput.bundleComponentSerials?.[comp.componentProductId] ?? [];

          if (compProd.serialTracking) {
            if (compSerials.length !== compQty.toNumber()) {
              throw new Error(
                `Bundle component '${compProd.name}' requires ${compQty.toNumber()} serial(s), got ${compSerials.length}.`,
              );
            }
            for (const sn of compSerials) {
              const row = lockedSerialsMap.get(sn.toLowerCase());
              if (!row || row.status !== 'in_stock' || row.productId !== compProd.id) {
                throw new Error(`Serial '${sn}' not in stock for bundle component '${compProd.name}'.`);
              }
            }
          }

          movementsToExecute.push({
            productId: comp.componentProductId,
            locationId: input.locationId,
            quantity: compQty.negated().toFixed(3),
            unitCostMinor: compProd.avgCostMinor,
            movementType: 'sale_delivery',
            referenceType: 'delivery_note',
            referenceId: deliveryNote!.id,
            notes: `Counter sale bundle: ${product.sku} → ${compProd.sku}`,
          });

          await tx.insert(deliveryNoteLines).values({
            deliveryNoteId: deliveryNote!.id,
            salesDocumentLineId: invLine.id,
            productId: comp.componentProductId,
            quantity: compQty.toFixed(3),
            unitCostMinor: compProd.avgCostMinor,
            totalCostMinor: compQty.times(compProd.avgCostMinor).toDecimalPlaces(0).toNumber(),
            isBundleComponent: true,
            bundleProductId: product.id,
            serialNumbers: compSerials.length > 0 ? compSerials : null,
          });

          // Update component serials
          for (const sn of compSerials) {
            const sRow = lockedSerialsMap.get(sn.toLowerCase())!;
            await tx
              .update(serialNumbers)
              .set({ status: 'sold', customerId: resolvedCustomerId, locationId: null, updatedAt: getNow() })
              .where(eq(serialNumbers.id, sRow.id));
          }
        }
      } else {
        // Standard product
        const lineSerials = lineInput.serialNumbers ?? [];

        movementsToExecute.push({
          productId: product.id,
          locationId: input.locationId,
          quantity: requestedQty.negated().toFixed(3),
          unitCostMinor: product.avgCostMinor,
          movementType: 'sale_delivery',
          referenceType: 'delivery_note',
          referenceId: deliveryNote!.id,
          notes: `Counter sale: ${invoiceNumber} — ${product.sku}`,
        });

        await tx.insert(deliveryNoteLines).values({
          deliveryNoteId: deliveryNote!.id,
          salesDocumentLineId: invLine.id,
          productId: product.id,
          quantity: requestedQty.toFixed(3),
          unitCostMinor: product.avgCostMinor,
          totalCostMinor: requestedQty.times(product.avgCostMinor).toDecimalPlaces(0).toNumber(),
          isBundleComponent: false,
          serialNumbers: lineSerials.length > 0 ? lineSerials : null,
        });

        // Update serials
        for (const sn of lineSerials) {
          const sRow = lockedSerialsMap.get(sn.toLowerCase())!;
          await tx
            .update(serialNumbers)
            .set({ status: 'sold', customerId: resolvedCustomerId, locationId: null, updatedAt: getNow() })
            .where(eq(serialNumbers.id, sRow.id));
        }
      }

      // Release any reservations for this invoice line (counter sales don't hold reservations
      // before sale, but release defensively in case of recalled held sale)
      await tx
        .update(stockReservations)
        .set({ status: 'fulfilled', fulfilledQty: requestedQty.toFixed(3) })
        .where(
          and(
            eq(stockReservations.sourceDocumentType, 'sales_document'),
            eq(stockReservations.sourceDocumentId, invoice!.id),
            eq(stockReservations.status, 'active'),
          ),
        );
    }

    // Execute all stock movements
    await executeStockMovements(tx, movementsToExecute, userId);

    // ── 4.15 Record payments ─────────────────────────────────────────────────
    const paymentResults: CounterSaleResult['payments'] = [];
    for (let i = 0; i < input.payments.length; i++) {
      const pmt = input.payments[i]!;
      const paymentKey = `${input.idempotencyKey}:pay:${i}`;

      // Build method_details including cash change
      let methodDetails: Record<string, unknown> = pmt.methodDetails ?? {};
      if (pmt.method === 'cash') {
        const tendered = pmt.tenderedMinor ?? pmt.appliedMinor;
        const change = tendered - pmt.appliedMinor;
        methodDetails = { ...methodDetails, tendered_minor: tendered, change_minor: change };
      }

      if (pmt.existingPaymentId) {
        // Lock existing payment FOR UPDATE
        const [existingPmt] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, pmt.existingPaymentId))
          .for('update');

        if (!existingPmt) {
          throw new Error(`Pre-authorized payment '${pmt.existingPaymentId}' not found.`);
        }
        if (existingPmt.status !== 'awaiting_sale') {
          throw new Error(
            `Payment '${pmt.existingPaymentId}' cannot be consumed: status is '${existingPmt.status}' (expected 'awaiting_sale').`,
          );
        }
        if (existingPmt.amountMinor < pmt.appliedMinor) {
          throw new Error(
            `Payment '${pmt.existingPaymentId}' amount (${existingPmt.amountMinor}) is less than applied amount (${pmt.appliedMinor}).`,
          );
        }

        // Transition from awaiting_sale -> confirmed
        const [confirmedPmt] = await tx
          .update(payments)
          .set({
            status: 'confirmed',
            confirmedAt: getNow(),
            shiftId: input.shiftId,
            updatedAt: getNow(),
          })
          .where(eq(payments.id, existingPmt.id))
          .returning();

        // Insert allocation linking to this invoice
        const [alloc] = await tx
          .insert(paymentAllocations)
          .values({
            paymentId: confirmedPmt!.id,
            invoiceId: invoice!.id,
            amountMinor: pmt.appliedMinor,
            allocatedBy: userId,
            notes: `Counter sale invoice ${invoiceNumber}`,
          })
          .returning();

        // Update invoice paidMinor and balanceMinor
        await tx
          .update(salesDocuments)
          .set({
            paidMinor: sql`${salesDocuments.paidMinor} + ${pmt.appliedMinor}`,
            balanceMinor: sql`${salesDocuments.balanceMinor} - ${pmt.appliedMinor}`,
            updatedAt: getNow(),
          })
          .where(eq(salesDocuments.id, invoice!.id));

        paymentResults.push({
          payment: confirmedPmt!,
        });
      } else {
        const result = await recordPaymentWithTx(
          tx,
          {
            idempotencyKey: paymentKey,
            customerId: resolvedCustomerId!,
            locationId: input.locationId,
            shiftId: input.shiftId,
            kind: 'receipt',
            method: pmt.method,
            amountMinor: pmt.appliedMinor,
            paymentDate: today,
            methodDetails,
            allocations: [{ invoiceId: invoice!.id, amountMinor: pmt.appliedMinor }],
          },
          userId,
        );
        paymentResults.push(result);
      }
    }

    if (input._testInjectFailureAfterPayments) {
      throw new Error('Injected failure after payments for atomicity verification');
    }

    // ── 4.16 Audit log ──────────────────────────────────────────────────────
    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'counter_sale_created',
        entityType: 'sales_document',
        entityId: invoice!.id,
        after: {
          invoiceNumber,
          shiftId: input.shiftId,
          totalMinor: totals.totalMinor,
          paymentMethods: input.payments.map((p) => p.method),
          overrideApproverId: overrideApproverId ?? null,
        },
      });
    }

    // ── 4.17 Refetch fresh invoice with updated balances after payments ─────
    const [freshInvoice] = await tx
      .select()
      .from(salesDocuments)
      .where(eq(salesDocuments.id, invoice!.id));

    return {
      invoice: (freshInvoice ?? finalInvoice ?? invoice)!,
      invoiceLines: insertedLines,
      deliveryNote: deliveryNote!,
      payments: paymentResults,
      changeMinor: totalChangeMinor,
    };
  });
}
