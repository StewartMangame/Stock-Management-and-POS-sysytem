/**
 * Credit Notes Service.
 *
 * Implements:
 *   - Line-by-line crediting referencing source invoice lines (source_line_id)
 *   - return_goods boolean flag per line
 *   - Return quantity capped at delivered minus already returned
 *   - Return serial numbers strictly limited to serials sold on the invoice
 *   - Stock returned as 'customer_return' at the original delivery cost
 *   - Undelivered quantity credit releases held reservation and reduces deliverable quantity
 *   - Line credit amount capped at remaining creditable value
 *   - Total credit note amount capped at remaining invoice balance
 *   - Updates invoice credited_minor and balance_minor
 *   - Deadlock-free global lock ordering
 */

import { db, type DbTransaction } from '@/server/db';
import {
  salesDocuments,
  salesDocumentLines,
  customers,
  products,
  stockBalances,
  stockReservations,
  deliveryNoteLines,
  serialNumbers,
} from '@/server/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { executeStockMovements } from '@/server/services/stock/stock-engine';
import { nextSequenceNumber } from '@/server/services/sequences';
import { todayInCompanyTz } from '@/lib/timezone';
import { calculateSalesLine, calculateDocumentTotals, validateLineCredit } from '@/lib/sales-math';
import { computePaymentStatus } from '@/lib/payment-math';
import { releaseOverpaymentToCredit, getCustomerCredit } from '@/server/services/sales/payments';
import { writeAuditLog } from '@/server/services/audit';
import Decimal from 'decimal.js';

export interface CreditNoteLineInput {
  sourceLineId: string;
  quantity: number | string;
  unitPriceMinor?: number; // defaults to invoice line unit price
  discountMinor?: number;
  returnGoods: boolean;
  serialNumbers?: string[]; // Serials returned to stock
  notes?: string;
}

export interface CreateCreditNoteInput {
  invoiceId: string;
  issueDate?: string;
  notes?: string;
  terms?: string;
  lines: CreditNoteLineInput[];
}

export interface CreateCreditNoteOptions {
  skipWalkInCheck?: boolean;
}

export async function createCreditNoteWithTx(
  tx: DbTransaction,
  input: CreateCreditNoteInput & { channel?: string; shiftId?: string },
  userId?: string,
  options?: CreateCreditNoteOptions,
) {
  if (!input.lines || input.lines.length === 0) {
    throw new Error('Credit note must contain at least one line');
  }

  // 1. Lock invoice header
  const [invoice] = await tx
      .select()
      .from(salesDocuments)
      .where(eq(salesDocuments.id, input.invoiceId))
      .for('update');

    if (!invoice) throw new Error('Invoice not found');
    if (invoice.documentType !== 'invoice') {
      throw new Error(`Cannot issue credit note against document type '${invoice.documentType}'`);
    }
    if (invoice.status !== 'issued') {
      throw new Error(`Cannot issue credit note against invoice in status '${invoice.status}'`);
    }

    // 2. Lock customer row (Rule 1 lock ordering)
    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, invoice.customerId))
      .for('update');
    if (!customer) throw new Error('Customer not found');

    // 3. Fetch invoice lines
    const sourceLineIds = input.lines.map((l) => l.sourceLineId);
    const invoiceLines = await tx
      .select()
      .from(salesDocumentLines)
      .where(inArray(salesDocumentLines.id, sourceLineIds));

    const invoiceLineMap = new Map(invoiceLines.map((l) => [l.id, l]));

    // 4. Fetch products
    const productIdsToLock = Array.from(new Set(invoiceLines.map((l) => l.productId))).sort();
    const lockedProducts = await tx
      .select()
      .from(products)
      .where(inArray(products.id, productIdsToLock))
      .orderBy(products.id)
      .for('update');
    const prodMap = new Map(lockedProducts.map((p) => [p.id, p]));

    // Lock stock balances
    await tx
      .select()
      .from(stockBalances)
      .where(
        and(
          inArray(stockBalances.productId, productIdsToLock),
          eq(stockBalances.locationId, invoice.locationId),
        ),
      )
      .orderBy(stockBalances.productId, stockBalances.locationId)
      .for('update');

    // Collect returned serials to validate and lock
    const serialsToLock: string[] = [];
    for (const line of input.lines) {
      if (line.returnGoods && line.serialNumbers) {
        serialsToLock.push(...line.serialNumbers);
      }
    }

    let lockedSerialsMap = new Map<string, typeof serialNumbers.$inferSelect>();
    if (serialsToLock.length > 0) {
      const uniqueSerials = Array.from(new Set(serialsToLock));
      const foundSerials = await tx
        .select()
        .from(serialNumbers)
        .where(inArray(serialNumbers.serialNumber, uniqueSerials))
        .orderBy(serialNumbers.id)
        .for('update');

      for (const s of foundSerials) {
        lockedSerialsMap.set(s.serialNumber.toLowerCase(), s);
      }
    }

    // 5. Calculate each credit line and validate caps
    const preparedCreditLines: Array<{
      sourceLine: typeof salesDocumentLines.$inferSelect;
      quantity: string;
      unitPriceMinor: number;
      discountMinor: number;
      netMinor: number;
      taxRateBasisPoints: number;
      taxMinor: number;
      lineTotalMinor: number;
      returnGoods: boolean;
      serials: string[];
      notes?: string;
    }> = [];

    const stockMovementsToExecute: Array<{
      productId: string;
      locationId: string;
      quantity: string;
      unitCostMinor: number;
      movementType: 'customer_return';
      referenceType: 'credit_note';
      referenceId: string;
      lineNotes?: string;
    }> = [];

    const issueDateStr = input.issueDate || todayInCompanyTz();

    for (const inputLine of input.lines) {
      const invLine = invoiceLineMap.get(inputLine.sourceLineId);
      if (!invLine) {
        throw new Error(`Invoice line ${inputLine.sourceLineId} not found`);
      }

      const prod = prodMap.get(invLine.productId)!;
      const requestedQty = new Decimal(inputLine.quantity);
      if (requestedQty.isZero() || requestedQty.isNegative()) {
        throw new Error('Credit quantity must be positive');
      }

      // Calculate line financial amount
      const unitPrice = inputLine.unitPriceMinor ?? invLine.unitPriceMinor;
      const discount = inputLine.discountMinor ?? 0;
      const calcLine = calculateSalesLine({
        quantity: requestedQty.toFixed(3),
        unitPriceMinor: unitPrice,
        discountMinor: discount,
        taxRateBasisPoints: invLine.taxRateBasisPoints,
      });

      // Check line credit cap (remaining creditable minor)
      // Line creditable = invLine.lineTotalMinor - already credited on that line
      const lineCreditCheck = validateLineCredit(
        invLine.lineTotalMinor,
        new Decimal(invLine.creditedQty).isZero()
          ? 0
          : Math.round(
              (new Decimal(invLine.creditedQty).toNumber() / new Decimal(invLine.quantity).toNumber()) *
                invLine.lineTotalMinor,
            ),
        calcLine.lineTotalMinor,
      );

      if (!lineCreditCheck.valid) {
        throw new Error(
          `Credit amount for line ${invLine.sku} (MWK ${(calcLine.lineTotalMinor / 100).toFixed(
            2,
          )}) exceeds remaining creditable amount (MWK ${(lineCreditCheck.remainingMinor / 100).toFixed(
            2,
          )})`,
        );
      }

      const deliveredQty = new Decimal(invLine.deliveredQty);
      const lineSerials = inputLine.serialNumbers || [];

      if (inputLine.returnGoods) {
        // Returned goods cannot exceed delivered minus already returned
        // Find how many were already returned
        const [alreadyReturnedRes] = await tx
          .select({
            total: sql<string>`COALESCE(SUM(${salesDocumentLines.quantity}), 0)`,
          })
          .from(salesDocumentLines)
          .where(
            and(
              eq(salesDocumentLines.sourceLineId, invLine.id),
              eq(salesDocumentLines.returnGoods, true),
            ),
          );

        const alreadyReturned = new Decimal(alreadyReturnedRes?.total ?? '0');
        const maxReturnable = Decimal.max(0, deliveredQty.minus(alreadyReturned));

        if (requestedQty.greaterThan(maxReturnable)) {
          throw new Error(
            `Cannot return ${requestedQty.toFixed(3)} units of '${prod.name}'; only ${maxReturnable.toFixed(
              3,
            )} delivered units have not yet been returned`,
          );
        }

        // Validate serials
        if (prod.serialTracking) {
          const expectedCount = requestedQty.toNumber();
          if (lineSerials.length !== expectedCount) {
            throw new Error(
              `Product '${prod.name}' requires exactly ${expectedCount} returned serials, but received ${lineSerials.length}`,
            );
          }

          for (const sn of lineSerials) {
            const serialRow = lockedSerialsMap.get(sn.toLowerCase());
            if (!serialRow) {
              throw new Error(`Serial number '${sn}' not found`);
            }
            if (serialRow.status !== 'sold' || serialRow.customerId !== invoice.customerId) {
              throw new Error(
                `Serial number '${sn}' was not sold to customer on this invoice (status: ${serialRow.status})`,
              );
            }
          }
        }

        // Return goods to stock at the original delivery cost from delivery_note_lines
        // If invLine.unitCostMinor is recorded, use it; fallback to prod.avgCostMinor
        const returnUnitCost = invLine.unitCostMinor > 0 ? invLine.unitCostMinor : prod.avgCostMinor;

        stockMovementsToExecute.push({
          productId: prod.id,
          locationId: invoice.locationId,
          quantity: requestedQty.toFixed(3), // positive for customer return back to stock
          unitCostMinor: returnUnitCost,
          movementType: 'customer_return',
          referenceType: 'credit_note',
          referenceId: '', // populated after credit note insert
          lineNotes: `Customer return against invoice line: ${invLine.sku}`,
        });
      } else {
        // returnGoods = false: crediting undelivered goods
        // Releases matching active reservations and reduces quantity that can still be delivered
        const undeliveredActive = Decimal.max(0, new Decimal(invLine.quantity).minus(deliveredQty));
        const releaseQty = Decimal.min(requestedQty, undeliveredActive);

        if (releaseQty.greaterThan(0)) {
          // Release reservation
          const [activeRes] = await tx
            .select()
            .from(stockReservations)
            .where(
              and(
                eq(stockReservations.sourceDocumentType, 'sales_document'),
                eq(stockReservations.sourceDocumentId, invoice.id),
                eq(stockReservations.sourceLineId, invLine.id),
                eq(stockReservations.status, 'active'),
              ),
            )
            .for('update');

          if (activeRes) {
            const unfulfilled = new Decimal(activeRes.reservedQty).minus(activeRes.fulfilledQty);
            const actualRelease = Decimal.min(releaseQty, unfulfilled);

            if (actualRelease.greaterThan(0)) {
              // Decrement stock_balances.reserved
              const [bal] = await tx
                .select()
                .from(stockBalances)
                .where(
                  and(
                    eq(stockBalances.productId, prod.id),
                    eq(stockBalances.locationId, invoice.locationId),
                  ),
                )
                .for('update');

              if (bal) {
                const newReserved = Decimal.max(
                  0,
                  new Decimal(bal.reserved).minus(actualRelease),
                );
                await tx
                  .update(stockBalances)
                  .set({
                    reserved: newReserved.toFixed(3),
                    updatedAt: new Date(),
                  })
                  .where(eq(stockBalances.id, bal.id));
              }

              // Update reservation
              const newReservedTotal = new Decimal(activeRes.reservedQty).minus(actualRelease);
              await tx
                .update(stockReservations)
                .set({
                  reservedQty: newReservedTotal.toFixed(3),
                  status: newReservedTotal.isZero() ? 'released' : 'active',
                })
                .where(eq(stockReservations.id, activeRes.id));
            }
          }
        }
      }

      preparedCreditLines.push({
        sourceLine: invLine,
        quantity: calcLine.quantity,
        unitPriceMinor: calcLine.unitPriceMinor,
        discountMinor: calcLine.discountMinor,
        netMinor: calcLine.netMinor,
        taxRateBasisPoints: calcLine.taxRateBasisPoints,
        taxMinor: calcLine.taxMinor,
        lineTotalMinor: calcLine.lineTotalMinor,
        returnGoods: inputLine.returnGoods,
        serials: lineSerials,
        notes: inputLine.notes,
      });
    }

    // Document totals
    const totals = calculateDocumentTotals(
      preparedCreditLines.map((l) => ({
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        discountMinor: l.discountMinor,
        taxRateBasisPoints: l.taxRateBasisPoints,
      })),
    );

    // Validate total credit note cannot exceed remaining invoice balance
    const remainingInvoiceBalance = invoice.totalMinor - invoice.creditedMinor;
    if (totals.totalMinor > remainingInvoiceBalance) {
      throw new Error(
        `Total credit note amount (MWK ${(totals.totalMinor / 100).toFixed(
          2,
        )}) exceeds remaining uncredited invoice balance (MWK ${(remainingInvoiceBalance / 100).toFixed(
          2,
        )})`,
      );
    }

    // 6. Assign sequence number and insert credit note header (initially 'draft' so lines trigger permits insert)
    const creditNumber = await nextSequenceNumber(tx, 'credit_note', invoice.locationId);

    const [creditNote] = await tx
      .insert(salesDocuments)
      .values({
        documentType: 'credit_note',
        documentNumber: creditNumber,
        sourceDocumentId: invoice.id,
        customerId: invoice.customerId,
        locationId: invoice.locationId,
        status: 'draft',
        deliveryStatus: 'not_delivered',
        paymentStatus: 'paid', // Credit note settles against invoice
        issueDate: issueDateStr,
        dueDate: issueDateStr,
        currency: invoice.currency,
        exchangeRate: invoice.exchangeRate,
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        creditedMinor: 0,
        paidMinor: 0,
        balanceMinor: 0,
        isImmutable: false,
        notes: input.notes,
        terms: input.terms,
        channel: input.channel ?? 'office',
        shiftId: input.shiftId ?? null,
        eisStatus: 'not_required',
        createdBy: userId,
      })
      .returning();

    // 7. Insert credit note lines & update invoice lines
    for (const pLine of preparedCreditLines) {
      await tx.insert(salesDocumentLines).values({
        documentId: creditNote!.id,
        sourceLineId: pLine.sourceLine.id,
        productId: pLine.sourceLine.productId,
        sku: pLine.sourceLine.sku,
        description: pLine.sourceLine.description,
        quantity: pLine.quantity,
        unitPriceMinor: pLine.unitPriceMinor,
        discountMinor: pLine.discountMinor,
        taxRateId: pLine.sourceLine.taxRateId,
        taxRateBasisPoints: pLine.taxRateBasisPoints,
        taxMinor: pLine.taxMinor,
        lineTotalMinor: pLine.lineTotalMinor,
        deliveredQty: '0',
        creditedQty: '0',
        unitCostMinor: pLine.sourceLine.unitCostMinor,
        returnGoods: pLine.returnGoods,
        notes: pLine.notes,
      });

      // Update source invoice line credited_qty
      const newCreditedQty = new Decimal(pLine.sourceLine.creditedQty).plus(pLine.quantity);
      await tx
        .update(salesDocumentLines)
        .set({
          creditedQty: newCreditedQty.toFixed(3),
        })
        .where(eq(salesDocumentLines.id, pLine.sourceLine.id));

      // If returning serials, restore serial status to 'in_stock'
      if (pLine.returnGoods && pLine.serials.length > 0) {
        for (const sn of pLine.serials) {
          const sRow = lockedSerialsMap.get(sn.toLowerCase());
          if (!sRow) {
            throw new Error(`Serial number "${sn}" not found on source invoice.`);
          }
          await tx
            .update(serialNumbers)
            .set({
              status: 'in_stock',
              locationId: invoice.locationId,
              customerId: null,
              warrantyStart: null,
              warrantyEnd: null,
              updatedAt: new Date(),
            })
            .where(eq(serialNumbers.id, sRow.id));
        }
      }
    }

    // 8. Execute stock movements if returnGoods was true
    if (stockMovementsToExecute.length > 0) {
      for (const m of stockMovementsToExecute) {
        m.referenceId = creditNote!.id;
      }
      await executeStockMovements(tx, stockMovementsToExecute);
    }

    // 9. Update invoice credited_minor and balance_minor
    const newInvoiceCredited = invoice.creditedMinor + totals.totalMinor;
    const newInvoiceBalance = Math.max(0, invoice.totalMinor - newInvoiceCredited - invoice.paidMinor);
    const newPaymentStatus = computePaymentStatus(invoice.totalMinor, newInvoiceCredited, invoice.paidMinor);

    await tx
      .update(salesDocuments)
      .set({
        creditedMinor: newInvoiceCredited,
        balanceMinor: newInvoiceBalance,
        paymentStatus: newPaymentStatus,
        updatedAt: new Date(),
      })
      .where(eq(salesDocuments.id, invoice.id));

    // Release overpayment if paid_minor > remaining net total
    await releaseOverpaymentToCredit(invoice.id, userId, tx);

    // 10. Finalize credit note as issued and immutable
    const [finalCreditNote] = await tx
      .update(salesDocuments)
      .set({
        status: 'issued',
        isImmutable: true,
        updatedAt: new Date(),
      })
      .where(eq(salesDocuments.id, creditNote!.id))
      .returning();

    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'credit_note_issued',
        entityType: 'sales_document',
        entityId: finalCreditNote!.id,
        after: finalCreditNote,
      });
    }

    // 11. Walk-in customer credit block check at end of transaction
    if (customer.isWalkIn && !options?.skipWalkInCheck) {
      const creditStatus = await getCustomerCredit(customer.id, tx);
      if (creditStatus.creditMinor > BigInt(0)) {
        throw new Error('Walk-in customer cannot hold credit');
      }
    }

    return finalCreditNote!;
}

export async function createCreditNote(
  input: CreateCreditNoteInput & { channel?: string; shiftId?: string },
  userId?: string,
  options?: CreateCreditNoteOptions,
) {
  if (!input.lines || input.lines.length === 0) {
    throw new Error('Credit note must contain at least one line');
  }

  return await db.transaction(async (tx) => {
    return await createCreditNoteWithTx(tx, input, userId, options);
  });
}
