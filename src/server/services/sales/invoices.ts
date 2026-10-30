/**
 * Invoicing Service.
 *
 * Implements:
 *   - Direct invoice creation (draft -> issue)
 *   - Quotation to invoice conversion (moves reservations cleanly)
 *   - Issue invoice with sequential numbering, credit limit verification,
 *     below-cost margin checks, and undelivered stock reservations
 *   - Void invoice with EIS acceptance block and reservation release
 *   - Strict deadlock-free lock ordering
 */

import { db, type DbTransaction } from '@/server/db';
import {
  salesDocuments,
  salesDocumentLines,
  quotations,
  quotationLines,
  customers,
  products,
  productBundles,
  stockBalances,
  stockReservations,
  taxRates,
} from '@/server/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { calculateDocumentTotals } from '@/lib/sales-math';
import { getNextDocNumber } from '@/server/services/sequences';
import { getSetting } from '@/server/services/settings';
import { writeAuditLog } from '@/server/services/audit';
import { getCustomerCreditStatus } from './customers';
import { reserveStockForLine, releaseReservationsForDocument } from './quotations';
import Decimal from 'decimal.js';

export interface CreateInvoiceLineInput {
  productId: string;
  quantity: number | string;
  unitPriceMinor: number;
  discountMinor?: number;
  taxRateId?: string;
  notes?: string;
}

export interface CreateInvoiceInput {
  customerId: string;
  locationId: string;
  issueDate?: string;
  dueDate?: string;
  currency?: string;
  exchangeRate?: number | string;
  notes?: string;
  terms?: string;
  lines: CreateInvoiceLineInput[];
}

/**
 * Creates a direct invoice in 'draft' status.
 */
export async function createDirectInvoice(input: CreateInvoiceInput, userId?: string) {
  if (!input.lines || input.lines.length === 0) {
    throw new Error('Invoice must contain at least one line');
  }

  // 1. Fetch customer to calculate payment terms
  const [customer] = await db.select().from(customers).where(eq(customers.id, input.customerId));
  if (!customer) throw new Error('Customer not found');

  // 2. Fetch default tax rate
  const [defaultTaxRate] = await db
    .select()
    .from(taxRates)
    .where(and(eq(taxRates.isDefault, true), eq(taxRates.isActive, true)));
  if (!defaultTaxRate) throw new Error('Default tax rate not configured');

  // 3. Fetch products to snapshot SKU and description
  const productIds = input.lines.map((l) => l.productId);
  const fetchedProducts = await db
    .select()
    .from(products)
    .where(inArray(products.id, productIds));
  const productMap = new Map(fetchedProducts.map((p) => [p.id, p]));

  // 4. Fetch tax rates
  const taxRateIds = Array.from(
    new Set(
      input.lines
        .map((l) => l.taxRateId || productMap.get(l.productId)?.taxRateId || defaultTaxRate.id)
        .filter(Boolean),
    ),
  ) as string[];
  const fetchedTaxRates = await db
    .select()
    .from(taxRates)
    .where(inArray(taxRates.id, taxRateIds));
  const taxRateMap = new Map(fetchedTaxRates.map((t) => [t.id, t]));

  // 5. Calculate line math
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
      description: p.description ?? p.name,
      notes: l.notes,
    };
  });

  const totals = calculateDocumentTotals(linesForMath);

  const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
  const dueDate = input.dueDate
    ? new Date(input.dueDate)
    : new Date(issueDate.getTime() + customer.paymentTermsDays * 24 * 60 * 60 * 1000);

  return await db.transaction(async (tx) => {
    const [invoice] = await tx
      .insert(salesDocuments)
      .values({
        documentType: 'invoice',
        customerId: input.customerId,
        locationId: input.locationId,
        status: 'draft',
        deliveryStatus: 'not_delivered',
        paymentStatus: 'unpaid',
        issueDate: issueDate.toISOString().split('T')[0]!,
        dueDate: dueDate.toISOString().split('T')[0]!,
        currency: (input.currency || 'MWK').toUpperCase(),
        exchangeRate: (input.exchangeRate || 1).toString(),
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        creditedMinor: 0,
        paidMinor: 0,
        balanceMinor: totals.totalMinor,
        isImmutable: false,
        notes: input.notes,
        terms: input.terms,
        eisStatus: 'not_required',
        createdBy: userId,
      })
      .returning();

    for (let i = 0; i < linesForMath.length; i++) {
      const lineMeta = linesForMath[i]!;
      const calculatedLine = totals.lines[i]!;

      await tx.insert(salesDocumentLines).values({
        documentId: invoice!.id,
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
        deliveredQty: '0',
        creditedQty: '0',
        unitCostMinor: 0,
        returnGoods: false,
        notes: lineMeta.notes,
      });
    }

    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'invoice_created',
        entityType: 'sales_document',
        entityId: invoice!.id,
        after: invoice,
      });
    }

    return invoice!;
  });
}

/**
 * Converts an accepted quotation into an invoice, moving held stock reservations.
 */
export async function convertQuotationToInvoice(quotationId: string, userId?: string) {
  return await db.transaction(async (tx) => {
    // 1. Lock quotation
    const [quote] = await tx
      .select()
      .from(quotations)
      .where(eq(quotations.id, quotationId))
      .for('update');

    if (!quote) throw new Error('Quotation not found');
    if (quote.status !== 'accepted') {
      throw new Error(`Quotation must be 'accepted' to convert. Current status: '${quote.status}'`);
    }

    // 2. Lock customer row
    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, quote.customerId))
      .for('update');

    if (!customer) throw new Error('Customer not found');

    // 3. Fetch quotation lines
    const quoteLines = await tx
      .select()
      .from(quotationLines)
      .where(eq(quotationLines.quotationId, quotationId));

    const issueDate = new Date();
    const dueDate = new Date(issueDate.getTime() + customer.paymentTermsDays * 24 * 60 * 60 * 1000);

    // 4. Create sales_document header
    const [invoice] = await tx
      .insert(salesDocuments)
      .values({
        documentType: 'invoice',
        sourceQuotationId: quote.id,
        customerId: quote.customerId,
        locationId: quote.locationId,
        status: 'draft',
        deliveryStatus: 'not_delivered',
        paymentStatus: 'unpaid',
        issueDate: issueDate.toISOString().split('T')[0]!,
        dueDate: dueDate.toISOString().split('T')[0]!,
        currency: quote.currency,
        exchangeRate: quote.exchangeRate,
        subtotalMinor: quote.subtotalMinor,
        discountMinor: quote.discountMinor,
        taxMinor: quote.taxMinor,
        totalMinor: quote.totalMinor,
        creditedMinor: 0,
        paidMinor: 0,
        balanceMinor: quote.totalMinor,
        isImmutable: false,
        notes: quote.notes,
        terms: quote.terms,
        eisStatus: 'not_required',
        createdBy: userId,
      })
      .returning();

    // 5. Insert invoice lines and move stock reservations
    for (const qLine of quoteLines) {
      const [invLine] = await tx
        .insert(salesDocumentLines)
        .values({
          documentId: invoice!.id,
          productId: qLine.productId,
          sku: qLine.sku,
          description: qLine.description,
          quantity: qLine.quantity,
          unitPriceMinor: qLine.unitPriceMinor,
          discountMinor: qLine.discountMinor,
          taxRateId: qLine.taxRateId,
          taxRateBasisPoints: qLine.taxRateBasisPoints,
          taxMinor: qLine.taxMinor,
          lineTotalMinor: qLine.lineTotalMinor,
          deliveredQty: '0',
          creditedQty: '0',
          unitCostMinor: 0,
          returnGoods: false,
          notes: qLine.notes,
        })
        .returning();

      // Move any reservations attached to this quotation line to the invoice line
      await tx
        .update(stockReservations)
        .set({
          sourceDocumentType: 'sales_document',
          sourceDocumentId: invoice!.id,
          sourceLineId: invLine!.id,
        })
        .where(
          and(
            eq(stockReservations.sourceDocumentType, 'quotation'),
            eq(stockReservations.sourceDocumentId, quote.id),
            eq(stockReservations.sourceLineId, qLine.id),
          ),
        );
    }

    // 6. Mark quotation as converted
    await tx
      .update(quotations)
      .set({
        status: 'converted',
        updatedAt: new Date(),
      })
      .where(eq(quotations.id, quote.id));

    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'quotation_converted_to_invoice',
        entityType: 'quotation',
        entityId: quote.id,
        after: { invoiceId: invoice!.id },
      });
    }

    return invoice!;
  });
}

/**
 * Issues an invoice:
 * - Assigns gap-free number (MAIN-INV-xxxx)
 * - Enforces credit limit and requires manager approval if exceeded
 * - Enforces below-cost and maximum discount checks
 * - Creates stock reservations for undelivered lines (if not already reserved)
 * - Activates database immutability trigger
 */
export async function issueInvoice(
  invoiceId: string,
  userId?: string,
  options?: { managerApproved?: boolean; approvalReason?: string },
) {
  return await db.transaction(async (tx) => {
    // 1. Lock invoice header
    const [invoice] = await tx
      .select()
      .from(salesDocuments)
      .where(eq(salesDocuments.id, invoiceId))
      .for('update');

    if (!invoice) throw new Error('Invoice not found');
    if (invoice.documentType !== 'invoice') {
      throw new Error(`Document is not an invoice (type: ${invoice.documentType})`);
    }
    if (invoice.status !== 'draft') {
      throw new Error(`Invoice cannot be issued in status '${invoice.status}'`);
    }

    // 2. Lock customer row (Rule 1 lock ordering)
    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, invoice.customerId))
      .for('update');

    if (!customer) throw new Error('Customer not found');

    // 3. Customer credit check
    if (!customer.isWalkIn) {
      const creditStatus = await getCustomerCreditStatus(customer.id, tx);
      const newTotalOutstanding = creditStatus.outstandingBalanceMinor + invoice.totalMinor;

      if (newTotalOutstanding > creditStatus.creditLimitMinor) {
        if (!options?.managerApproved) {
          throw new Error(
            `Customer credit limit exceeded. Limit: MWK ${(creditStatus.creditLimitMinor / 100).toFixed(
              2,
            )}, Current Outstanding: MWK ${(creditStatus.outstandingBalanceMinor / 100).toFixed(
              2,
            )}, Invoice Total: MWK ${(invoice.totalMinor / 100).toFixed(
              2,
            )}. Manager approval required.`,
          );
        }
      }
    }

    // 4. Fetch invoice lines
    const lines = await tx
      .select()
      .from(salesDocumentLines)
      .where(eq(salesDocumentLines.documentId, invoiceId));

    // 5. Margin and discount checks
    const maxDiscountSetting = await getSetting('max_discount_percent_without_approval');
    const maxDiscountAllowed = typeof maxDiscountSetting === 'number' ? maxDiscountSetting : 10;

    const productIds = lines.map((l) => l.productId);
    const fetchedProds = await tx
      .select()
      .from(products)
      .where(inArray(products.id, productIds));
    const prodMap = new Map(fetchedProds.map((p) => [p.id, p]));

    for (const line of lines) {
      const p = prodMap.get(line.productId);
      if (!p) continue;

      // Check below cost
      if (line.unitPriceMinor < p.avgCostMinor) {
        if (!options?.managerApproved) {
          throw new Error(
            `Line item for product '${p.name}' is priced below company average cost (Unit Price: MWK ${(
              line.unitPriceMinor / 100
            ).toFixed(2)}, Avg Cost: MWK ${(p.avgCostMinor / 100).toFixed(
              2,
            )}). Manager approval required.`,
          );
        }
      }

      // Check discount %
      const grossMinor = new Decimal(line.quantity).times(line.unitPriceMinor).toNumber();
      if (grossMinor > 0) {
        const discountPct = (line.discountMinor / grossMinor) * 100;
        if (discountPct > maxDiscountAllowed) {
          if (!options?.managerApproved) {
            throw new Error(
              `Line discount of ${discountPct.toFixed(
                1,
              )}% exceeds maximum allowed without manager approval (${maxDiscountAllowed}%). Manager approval required.`,
            );
          }
        }
      }
    }

    // 6. Lock products and stock balances for reservations
    const productIdsToReserve = new Set<string>();
    for (const line of lines) {
      productIdsToReserve.add(line.productId);
    }

    // Check bundle components
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

    const sortedProductIds = Array.from(productIdsToReserve).sort();
    if (sortedProductIds.length > 0) {
      await tx
        .select()
        .from(products)
        .where(inArray(products.id, sortedProductIds))
        .orderBy(products.id)
        .for('update');

      await tx
        .select()
        .from(stockBalances)
        .where(
          and(
            inArray(stockBalances.productId, sortedProductIds),
            eq(stockBalances.locationId, invoice.locationId),
          ),
        )
        .orderBy(stockBalances.productId, stockBalances.locationId)
        .for('update');
    }

    // Check existing reservations for this invoice
    const existingReservations = await tx
      .select()
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.sourceDocumentType, 'sales_document'),
          eq(stockReservations.sourceDocumentId, invoice.id),
          eq(stockReservations.status, 'active'),
        ),
      );

    // If direct invoice (no reservations yet), reserve stock for undelivered lines
    if (existingReservations.length === 0) {
      for (const line of lines) {
        const prod = prodMap.get(line.productId);
        if (!prod || prod.productType === 'service') continue;

        if (prod.productType === 'bundle') {
          const components = bundleComponentsMap.get(prod.id) || [];
          for (const comp of components) {
            const compRequired = new Decimal(line.quantity).times(comp.quantity);
            await reserveStockForLine(tx, {
              productId: comp.componentProductId,
              locationId: invoice.locationId,
              sourceDocumentType: 'sales_document',
              sourceDocumentId: invoice.id,
              sourceLineId: line.id,
              quantity: compRequired.toFixed(3),
            });
          }
        } else {
          await reserveStockForLine(tx, {
            productId: line.productId,
            locationId: invoice.locationId,
            sourceDocumentType: 'sales_document',
            sourceDocumentId: invoice.id,
            sourceLineId: line.id,
            quantity: line.quantity,
          });
        }
      }
    }

    // 7. Generate gap-free sequential invoice number in this transaction
    const invoiceNumber = await getNextDocNumber(tx, 'invoice', invoice.locationId);

    // 8. Update invoice to issued and immutable
    const [issued] = await tx
      .update(salesDocuments)
      .set({
        documentNumber: invoiceNumber,
        status: 'issued',
        isImmutable: true,
        balanceMinor: invoice.totalMinor,
        approvedBy: options?.managerApproved ? userId : null,
        approvedAt: options?.managerApproved ? new Date() : null,
        approvalReason: options?.approvalReason,
        updatedAt: new Date(),
      })
      .where(eq(salesDocuments.id, invoice.id))
      .returning();

    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'invoice_issued',
        entityType: 'sales_document',
        entityId: invoice.id,
        before: invoice,
        after: issued,
      });
    }

    return issued!;
  });
}

/**
 * Voids an issued invoice:
 * - Blocked if goods have already been delivered (delivery_status !== 'not_delivered')
 * - Blocked if EIS has accepted the invoice
 * - Releases all held stock reservations
 * - Sets status = 'void', balance_minor = 0
 */
export async function voidInvoice(invoiceId: string, userId?: string, reason?: string) {
  return await db.transaction(async (tx) => {
    // 1. Lock invoice header
    const [invoice] = await tx
      .select()
      .from(salesDocuments)
      .where(eq(salesDocuments.id, invoiceId))
      .for('update');

    if (!invoice) throw new Error('Invoice not found');
    if (invoice.documentType !== 'invoice') {
      throw new Error('Only invoices can be voided via voidInvoice');
    }
    if (invoice.status === 'void') {
      throw new Error('Invoice is already void');
    }

    // Deliveries prevent voiding
    if (invoice.deliveryStatus !== 'not_delivered') {
      throw new Error(
        `Cannot void invoice with status '${invoice.deliveryStatus}'. Issued credit note must be used for delivered goods.`,
      );
    }

    // Clear hook: EIS acceptance prevents voiding (Phase 5 will enforce)
    if (invoice.eisStatus === 'accepted') {
      throw new Error('Cannot void invoice after acceptance by MRA EIS');
    }

    // 2. Lock customer row
    await tx
      .select()
      .from(customers)
      .where(eq(customers.id, invoice.customerId))
      .for('update');

    // 3. Release any held stock reservations
    await releaseReservationsForDocument(tx, 'sales_document', invoice.id);

    // 4. Update status to void
    const [voided] = await tx
      .update(salesDocuments)
      .set({
        status: 'void',
        balanceMinor: 0,
        voidedAt: new Date(),
        voidedBy: userId,
        voidReason: reason || 'Voided by user',
        updatedAt: new Date(),
      })
      .where(eq(salesDocuments.id, invoice.id))
      .returning();

    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'invoice_voided',
        entityType: 'sales_document',
        entityId: invoice.id,
        before: invoice,
        after: voided,
      });
    }

    return voided!;
  });
}
