/**
 * Delivery Notes Service.
 *
 * Implements:
 *   - Stock dispatch using Phase 1 executeStockMovements ('sale_delivery')
 *   - Status is strictly 'dispatched' (no cancellation in Phase 2)
 *   - Serial number capture and transition to 'sold' with calculated warranty dates
 *   - Bundle component expansion and component serial capture
 *   - Reservation fulfillment and stock_balances.reserved decrement
 *   - Invoice delivery_status update ('not_delivered' | 'partly_delivered' | 'delivered')
 *   - Weighted average delivery cost tracking on invoice lines
 *   - Deadlock-free global lock ordering
 */

import { db, type DbTransaction } from '@/server/db';
import {
  deliveryNotes,
  deliveryNoteLines,
  salesDocuments,
  salesDocumentLines,
  customers,
  products,
  productBundles,
  stockBalances,
  stockReservations,
  serialNumbers,
} from '@/server/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { executeStockMovements } from '@/server/services/stock/stock-engine';
import { getNextDocNumber } from '@/server/services/sequences';
import { writeAuditLog } from '@/server/services/audit';
import Decimal from 'decimal.js';

export interface DeliveryLineInput {
  salesDocumentLineId: string;
  quantity: number | string;
  serialNumbers?: string[]; // Serial strings for standard serial-tracked items
  bundleComponentSerials?: Record<string, string[]>; // componentProductId -> serial strings
}

export interface CreateDeliveryNoteInput {
  salesDocumentId: string;
  deliveryDate?: string;
  notes?: string;
  receivedByCustomer?: string;
  lines: DeliveryLineInput[];
}

export async function createDeliveryNote(input: CreateDeliveryNoteInput, userId?: string) {
  if (!input.lines || input.lines.length === 0) {
    throw new Error('Delivery note must contain at least one line');
  }

  return await db.transaction(async (tx) => {
    // 1. Lock invoice header
    const [invoice] = await tx
      .select()
      .from(salesDocuments)
      .where(eq(salesDocuments.id, input.salesDocumentId))
      .for('update');

    if (!invoice) throw new Error('Invoice not found');
    if (invoice.documentType !== 'invoice') {
      throw new Error(`Cannot deliver on document type '${invoice.documentType}'`);
    }
    if (invoice.status !== 'issued') {
      throw new Error(`Cannot dispatch delivery for invoice in status '${invoice.status}'`);
    }

    // 2. Lock customer row (Rule 1 lock ordering)
    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, invoice.customerId))
      .for('update');
    if (!customer) throw new Error('Customer not found');

    // 3. Fetch invoice lines
    const lineIds = input.lines.map((l) => l.salesDocumentLineId);
    const invoiceLines = await tx
      .select()
      .from(salesDocumentLines)
      .where(inArray(salesDocumentLines.id, lineIds));

    const invoiceLineMap = new Map(invoiceLines.map((l) => [l.id, l]));

    // 4. Fetch products for lines and bundle components
    const productIdsToLock = new Set<string>();
    for (const invLine of invoiceLines) {
      productIdsToLock.add(invLine.productId);
    }

    const fetchedProds = await tx
      .select()
      .from(products)
      .where(inArray(products.id, Array.from(productIdsToLock)));
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
        productIdsToLock.add(comp.componentProductId);
      }
    }

    // Lock all involved product rows ordered by ID ASC
    const sortedProductIds = Array.from(productIdsToLock).sort();
    const lockedProducts = await tx
      .select()
      .from(products)
      .where(inArray(products.id, sortedProductIds))
      .orderBy(products.id)
      .for('update');
    const lockedProdMap = new Map(lockedProducts.map((p) => [p.id, p]));

    // Lock stock balances ordered by product_id ASC, location_id ASC
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

    // 5. Generate gap-free delivery note number
    const deliveryNumber = await getNextDocNumber(tx, 'delivery_note', invoice.locationId);
    const deliveryDateStr = input.deliveryDate || new Date().toISOString().split('T')[0]!;
    const deliveryDateObj = new Date(deliveryDateStr);

    // 6. Insert delivery note header (status: 'dispatched')
    const [deliveryNote] = await tx
      .insert(deliveryNotes)
      .values({
        deliveryNumber,
        salesDocumentId: invoice.id,
        locationId: invoice.locationId,
        customerId: invoice.customerId,
        deliveryDate: deliveryDateStr,
        status: 'dispatched',
        notes: input.notes,
        receivedByCustomer: input.receivedByCustomer,
        createdBy: userId,
      })
      .returning();

    // 7. Validate quantities and prepare stock movements
    const movementsToExecute: Array<{
      productId: string;
      locationId: string;
      quantity: string;
      unitCostMinor: number;
      movementType: 'sale_delivery';
      referenceType: 'delivery_note';
      referenceId: string;
      lineNotes?: string;
    }> = [];

    // Collect all serials to validate and lock
    const serialsToLock: string[] = [];
    for (const lineInput of input.lines) {
      if (lineInput.serialNumbers) {
        serialsToLock.push(...lineInput.serialNumbers);
      }
      if (lineInput.bundleComponentSerials) {
        for (const compSerials of Object.values(lineInput.bundleComponentSerials)) {
          serialsToLock.push(...compSerials);
        }
      }
    }

    let lockedSerialsMap = new Map<string, typeof serialNumbers.$inferSelect>();
    if (serialsToLock.length > 0) {
      const uniqueSerials = Array.from(new Set(serialsToLock));
      const foundSerials = await tx
        .select()
        .from(serialNumbers)
        .where(
          and(
            inArray(serialNumbers.serialNumber, uniqueSerials),
            eq(serialNumbers.locationId, invoice.locationId),
          ),
        )
        .orderBy(serialNumbers.id)
        .for('update');

      for (const s of foundSerials) {
        lockedSerialsMap.set(s.serialNumber.toLowerCase(), s);
      }
    }

    // Process each delivery line
    for (const lineInput of input.lines) {
      const invLine = invoiceLineMap.get(lineInput.salesDocumentLineId);
      if (!invLine) {
        throw new Error(`Invoice line ${lineInput.salesDocumentLineId} not found`);
      }

      const requestedQty = new Decimal(lineInput.quantity);
      if (requestedQty.isZero() || requestedQty.isNegative()) {
        throw new Error('Delivery quantity must be positive');
      }

      const currentDelivered = new Decimal(invLine.deliveredQty);
      const invoicedQty = new Decimal(invLine.quantity);
      const remainingToDeliver = invoicedQty.minus(currentDelivered);

      if (requestedQty.greaterThan(remainingToDeliver)) {
        throw new Error(
          `Delivery quantity ${requestedQty.toFixed(3)} exceeds remaining undelivered quantity ${remainingToDeliver.toFixed(
            3,
          )} for line ${invLine.sku}`,
        );
      }

      const prod = lockedProdMap.get(invLine.productId)!;

      if (prod.productType === 'bundle') {
        const components = bundleComponentsMap.get(prod.id) || [];
        for (const comp of components) {
          const compProd = lockedProdMap.get(comp.componentProductId)!;
          const compQty = requestedQty.times(comp.quantity);

          // Validate serials for component if tracked
          const compSerials = lineInput.bundleComponentSerials?.[comp.componentProductId] || [];
          if (compProd.serialTracking) {
            const expectedCount = compQty.toNumber();
            if (compSerials.length !== expectedCount) {
              throw new Error(
                `Component product '${compProd.name}' requires exactly ${expectedCount} serials, but received ${compSerials.length}`,
              );
            }

            for (const sn of compSerials) {
              const serialRow = lockedSerialsMap.get(sn.toLowerCase());
              if (!serialRow || serialRow.status !== 'in_stock' || serialRow.productId !== compProd.id) {
                throw new Error(
                  `Serial number '${sn}' is not in stock at dispatch location for component '${compProd.name}'`,
                );
              }
            }
          }

          // Stock movement for component
          movementsToExecute.push({
            productId: comp.componentProductId,
            locationId: invoice.locationId,
            quantity: compQty.negated().toFixed(3), // negative for issue out
            unitCostMinor: compProd.avgCostMinor,
            movementType: 'sale_delivery',
            referenceType: 'delivery_note',
            referenceId: deliveryNote!.id,
            lineNotes: `Bundle dispatch: ${prod.sku} -> ${compProd.sku}`,
          });

          // Insert delivery note line for component
          await tx.insert(deliveryNoteLines).values({
            deliveryNoteId: deliveryNote!.id,
            salesDocumentLineId: invLine.id,
            productId: comp.componentProductId,
            quantity: compQty.toFixed(3),
            unitCostMinor: compProd.avgCostMinor,
            totalCostMinor: compQty.times(compProd.avgCostMinor).toDecimalPlaces(0).toNumber(),
            isBundleComponent: true,
            bundleProductId: prod.id,
            serialNumbers: compSerials.length > 0 ? compSerials : null,
          });

          // Fulfill stock reservation for component
          await fulfillReservationForLine(tx, {
            sourceDocumentId: invoice.id,
            sourceLineId: invLine.id,
            productId: comp.componentProductId,
            locationId: invoice.locationId,
            quantity: compQty.toFixed(3),
          });

          // Update serials for component
          if (compSerials.length > 0) {
            const warrantyEnd = new Date(deliveryDateObj);
            warrantyEnd.setMonth(warrantyEnd.getMonth() + compProd.warrantyMonths);

            for (const sn of compSerials) {
              const sRow = lockedSerialsMap.get(sn.toLowerCase());
              if (!sRow) {
                throw new Error(`Component serial number "${sn}" not found or not in location stock.`);
              }
              await tx
                .update(serialNumbers)
                .set({
                  status: 'sold',
                  customerId: invoice.customerId,
                  locationId: null,
                  warrantyStart: deliveryDateStr,
                  warrantyEnd: warrantyEnd.toISOString().split('T')[0]!,
                  updatedAt: new Date(),
                })
                .where(eq(serialNumbers.id, sRow.id));
            }
          }
        }
      } else {
        // Standard product dispatch
        const lineSerials = lineInput.serialNumbers || [];
        if (prod.serialTracking) {
          const expectedCount = requestedQty.toNumber();
          if (lineSerials.length !== expectedCount) {
            throw new Error(
              `Product '${prod.name}' requires exactly ${expectedCount} serials, but received ${lineSerials.length}`,
            );
          }

          for (const sn of lineSerials) {
            const serialRow = lockedSerialsMap.get(sn.toLowerCase());
            if (!serialRow || serialRow.status !== 'in_stock' || serialRow.productId !== prod.id) {
              throw new Error(
                `Serial number '${sn}' is not in stock at dispatch location for product '${prod.name}'`,
              );
            }
          }
        }

        movementsToExecute.push({
          productId: prod.id,
          locationId: invoice.locationId,
          quantity: requestedQty.negated().toFixed(3),
          unitCostMinor: prod.avgCostMinor,
          movementType: 'sale_delivery',
          referenceType: 'delivery_note',
          referenceId: deliveryNote!.id,
          lineNotes: `Dispatch against invoice line: ${invLine.sku}`,
        });

        await tx.insert(deliveryNoteLines).values({
          deliveryNoteId: deliveryNote!.id,
          salesDocumentLineId: invLine.id,
          productId: prod.id,
          quantity: requestedQty.toFixed(3),
          unitCostMinor: prod.avgCostMinor,
          totalCostMinor: requestedQty.times(prod.avgCostMinor).toDecimalPlaces(0).toNumber(),
          isBundleComponent: false,
          serialNumbers: lineSerials.length > 0 ? lineSerials : null,
        });

        // Fulfill stock reservation for standard product
        await fulfillReservationForLine(tx, {
          sourceDocumentId: invoice.id,
          sourceLineId: invLine.id,
          productId: prod.id,
          locationId: invoice.locationId,
          quantity: requestedQty.toFixed(3),
        });

        // Update serials to sold
        if (lineSerials.length > 0) {
          const warrantyEnd = new Date(deliveryDateObj);
          warrantyEnd.setMonth(warrantyEnd.getMonth() + prod.warrantyMonths);

          for (const sn of lineSerials) {
            const sRow = lockedSerialsMap.get(sn.toLowerCase());
            if (!sRow) {
              throw new Error(`Serial number "${sn}" not found or not in location stock.`);
            }
            await tx
              .update(serialNumbers)
              .set({
                status: 'sold',
                customerId: invoice.customerId,
                locationId: null,
                warrantyStart: deliveryDateStr,
                warrantyEnd: warrantyEnd.toISOString().split('T')[0]!,
                updatedAt: new Date(),
              })
              .where(eq(serialNumbers.id, sRow.id));
          }
        }
      }

      // Update invoice line delivered_qty and weighted average unit_cost_minor
      const newDelivered = currentDelivered.plus(requestedQty);
      const prevDeliveredNum = currentDelivered.toNumber();
      const newRequestedNum = requestedQty.toNumber();
      const currentWeightedCost = invLine.unitCostMinor;
      const dispatchCost = prod.avgCostMinor;

      const updatedWeightedCost =
        prevDeliveredNum + newRequestedNum > 0
          ? Math.round(
              (prevDeliveredNum * currentWeightedCost + newRequestedNum * dispatchCost) /
                (prevDeliveredNum + newRequestedNum),
            )
          : dispatchCost;

      await tx
        .update(salesDocumentLines)
        .set({
          deliveredQty: newDelivered.toFixed(3),
          unitCostMinor: updatedWeightedCost,
        })
        .where(eq(salesDocumentLines.id, invLine.id));
    }

    // 8. Execute all movements using Phase 1 stock ledger engine
    await executeStockMovements(tx, movementsToExecute);

    // 9. Recalculate invoice overall delivery_status
    const allInvoiceLines = await tx
      .select()
      .from(salesDocumentLines)
      .where(eq(salesDocumentLines.documentId, invoice.id));

    let allDelivered = true;
    let anyDelivered = false;

    for (const line of allInvoiceLines) {
      const delivered = new Decimal(line.deliveredQty);
      const ordered = new Decimal(line.quantity);

      if (delivered.greaterThan(0)) {
        anyDelivered = true;
      }
      if (delivered.lessThan(ordered)) {
        allDelivered = false;
      }
    }

    const newDeliveryStatus = allDelivered
      ? 'delivered'
      : anyDelivered
      ? 'partly_delivered'
      : 'not_delivered';

    await tx
      .update(salesDocuments)
      .set({
        deliveryStatus: newDeliveryStatus,
        updatedAt: new Date(),
      })
      .where(eq(salesDocuments.id, invoice.id));

    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'delivery_note_created',
        entityType: 'delivery_note',
        entityId: deliveryNote!.id,
        after: deliveryNote,
      });
    }

    return deliveryNote!;
  });
}

/**
 * Updates stock_reservations upon delivery:
 * Increases fulfilled_qty. If fulfilled_qty >= reserved_qty, status becomes 'fulfilled'.
 * Decrements stock_balances.reserved by the delivered quantity.
 */
async function fulfillReservationForLine(
  tx: DbTransaction,
  params: {
    sourceDocumentId: string;
    sourceLineId: string;
    productId: string;
    locationId: string;
    quantity: string;
  },
) {
  const [res] = await tx
    .select()
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.sourceDocumentType, 'sales_document'),
        eq(stockReservations.sourceDocumentId, params.sourceDocumentId),
        eq(stockReservations.sourceLineId, params.sourceLineId),
        eq(stockReservations.productId, params.productId),
        eq(stockReservations.status, 'active'),
      ),
    )
    .for('update');

  const fulfillAmount = new Decimal(params.quantity);

  if (res) {
    const currentFulfilled = new Decimal(res.fulfilledQty);
    const newFulfilled = currentFulfilled.plus(fulfillAmount);
    const reservedTotal = new Decimal(res.reservedQty);
    const isCompleted = newFulfilled.greaterThanOrEqualTo(reservedTotal);

    await tx
      .update(stockReservations)
      .set({
        fulfilledQty: newFulfilled.toFixed(3),
        status: isCompleted ? 'fulfilled' : 'active',
      })
      .where(eq(stockReservations.id, res.id));
  }

  // Decrement stock_balances.reserved
  const [bal] = await tx
    .select()
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.productId, params.productId),
        eq(stockBalances.locationId, params.locationId),
      ),
    )
    .for('update');

  if (bal) {
    const newReserved = Decimal.max(0, new Decimal(bal.reserved).minus(fulfillAmount));
    await tx
      .update(stockBalances)
      .set({
        reserved: newReserved.toFixed(3),
        updatedAt: new Date(),
      })
      .where(eq(stockBalances.id, bal.id));
  }
}
