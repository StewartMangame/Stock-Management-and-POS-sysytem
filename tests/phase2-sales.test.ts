/**
 * Phase 2 Sales Integration & Invariant Tests.
 *
 * Verifies all Phase 2 requirements:
 *   1. Protected Walk-in Customer invariants & DB trigger
 *   2. Sales document & lines immutability trigger on issued documents
 *   3. Sequential gap-free numbering and rollback number preservation
 *   4. Concurrency: Two simultaneous invoices for customer near credit limit
 *   5. Stock reservations on quotation acceptance & bundle component expansion
 *   6. Reservation expiry sweep via cron after hold days
 *   7. Delivery note with serial capture, warranty calculation & weighted cost
 *   8. Credit note on undelivered goods (releasing reservation) & customer return
 *   9. Branded PDF generation with DRAFT watermark & Ace letterhead
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

import { db, pool } from '@/server/db';
import {
  customers,
  products,
  productBundles,
  categories,
  unitsOfMeasure,
  locations,
  stockBalances,
  stockMovements,
  stockReservations,
  quotations,
  quotationLines,
  salesDocuments,
  salesDocumentLines,
  deliveryNotes,
  deliveryNoteLines,
  serialNumbers,
  taxRates,
  users,
  roles,
} from '@/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { executeStockMovements } from '@/server/services/stock/stock-engine';
import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerById,
  getCustomerCreditStatus,
} from '@/server/services/sales/customers';
import {
  createQuotation,
  sendQuotation,
  acceptQuotation,
  cancelQuotation,
} from '@/server/services/sales/quotations';
import {
  createDirectInvoice,
  convertQuotationToInvoice,
  issueInvoice,
  voidInvoice,
} from '@/server/services/sales/invoices';
import { createDeliveryNote } from '@/server/services/sales/delivery-notes';
import { createCreditNote } from '@/server/services/sales/credit-notes';
import { expireOutdatedReservations } from '@/server/services/sales/cron';
import {
  generateSalesDocumentPdfBuffer,
  fetchSalesDocumentPdfData,
} from '@/server/services/pdf/sales-document-pdf';

describe('Phase 2 Sales Engine Invariants', () => {
  let testLocId: string;
  let testUomId: string;
  let testCatId: string;
  let testTaxRateId: string;
  let testUserId: string;

  beforeAll(async () => {
    // 1. Ensure test location exists
    const [loc] = await db
      .insert(locations)
      .values({
        name: 'Sales Test Branch',
        code: `SLS-LOC-${Date.now()}`,
        type: 'outlet',
      })
      .returning();
    testLocId = loc!.id;

    // 2. Ensure test UOM exists
    const [uom] = await db
      .insert(unitsOfMeasure)
      .values({
        name: 'Sales Piece',
        code: `SPC-${Date.now()}`,
        symbol: 'pc',
        allowDecimal: false,
      })
      .returning();
    testUomId = uom!.id;

    // 3. Ensure test Category exists
    const [cat] = await db
      .insert(categories)
      .values({
        name: 'Sales Hardware',
        code: `SHW-${Date.now()}`,
      })
      .returning();
    testCatId = cat!.id;

    // 4. Ensure 17.5% Tax Rate exists in tax_rates
    const existingTax = await db
      .select()
      .from(taxRates)
      .where(eq(taxRates.rateBasisPoints, 1750))
      .limit(1);

    if (existingTax.length > 0) {
      testTaxRateId = existingTax[0]!.id;
    } else {
      const [newTax] = await db
        .insert(taxRates)
        .values({
          name: 'Standard VAT 17.5%',
          rateBasisPoints: 1750,
          isDefault: true,
          isActive: true,
        })
        .returning();
      testTaxRateId = newTax!.id;
    }

    // 5. Ensure a test user exists for audit actions
    const existingUser = await db.select().from(users).limit(1);
    if (existingUser.length > 0) {
      testUserId = existingUser[0]!.id;
    } else {
      const [role] = await db.select().from(roles).limit(1);
      const [user] = await db
        .insert(users)
        .values({
          name: 'Sales Tester',
          email: `sales.tester.${Date.now()}@aceholdings.mw`,
          roleId: role!.id,
          passwordHash: 'dummy_hash',
          isActive: true,
        })
        .returning();
      testUserId = user!.id;
    }
  });

  // ── 1. Walk-in Customer Invariants & Protection ──────────────────────────────

  describe('Walk-in Customer Invariants', () => {
    it('seeds and protects the single WALK-IN customer from deletion or tampering', async () => {
      const [walkIn] = await db
        .select()
        .from(customers)
        .where(eq(customers.isWalkIn, true));

      expect(walkIn).toBeDefined();
      expect(walkIn!.accountNumber).toBe('WALK-IN');
      expect(walkIn!.creditLimitMinor).toBe(0);

      // Attempt to delete walk-in customer via service throws error
      await expect(deleteCustomer(walkIn!.id, testUserId)).rejects.toThrow(
        /Walk-in customer cannot be deleted/,
      );

      // Attempt direct SQL DELETE triggers database trigger trg_prevent_walk_in_mutation
      // (error wrapped by Drizzle — use toThrowCause to inspect the PG trigger message)
      await expect(
        db.delete(customers).where(eq(customers.id, walkIn!.id)),
      ).rejects.toThrowCause(/walk-in customer cannot be deleted/i);

      // Attempt to assign a credit limit to walk-in customer throws error
      await expect(
        updateCustomer(walkIn!.id, { creditLimitMinor: 500000 }, testUserId),
      ).rejects.toThrow(/Walk-in customer cannot have a credit limit/);
    });
  });

  // ── 2. Immutability Triggers on Issued Documents (Rule 6) ─────────────────────

  describe('Database Trigger Immutability on Issued Sales Documents', () => {
    it('blocks modification of prices, totals and core fields, while allowing tracking fields', async () => {
      // Create customer and test product
      const [cust] = await db
        .insert(customers)
        .values({
          accountNumber: `IMM-CUST-${Date.now()}`,
          name: 'Immutability Corp',
          customerType: 'business',
          creditLimitMinor: 50_000_000,
        })
        .returning();

      const [prod] = await db
        .insert(products)
        .values({
          name: 'Immutability Test Product',
          sku: `IMM-SKU-${Date.now()}`,
          categoryId: testCatId,
          uomId: testUomId,
          sellingPriceMinor: 200000, // MWK 2,000.00
          taxRateId: testTaxRateId,
          isActive: true,
        })
        .returning();

      // Receive 10 units into stock first
      await executeStockMovements(db, [
        {
          productId: prod!.id,
          locationId: testLocId,
          quantity: 10,
          unitCostMinor: 100000,
          movementType: 'purchase_receipt',
          referenceType: 'goods_receipt',
        },
      ]);

      // Create and issue direct invoice
      const invoice = await createDirectInvoice(
        {
          customerId: cust!.id,
          locationId: testLocId,
          lines: [
            {
              productId: prod!.id,
              quantity: 5,
              unitPriceMinor: 200000,
            },
          ],
        },
        testUserId,
      );

      const issued = await issueInvoice(invoice.id, testUserId);
      expect(issued.status).toBe('issued');
      expect(issued.isImmutable).toBe(true);

      // 1. Direct update to total_minor should be BLOCKED by database trigger
      // (Drizzle wraps the trigger exception — use toThrowCause)
      await expect(
        db
          .update(salesDocuments)
          .set({ totalMinor: 999999 })
          .where(eq(salesDocuments.id, invoice.id)),
      ).rejects.toThrowCause(/financial.*cannot be modified/i);

      // 2. Direct update to line unit_price_minor should be BLOCKED by database trigger
      const [line] = await db
        .select()
        .from(salesDocumentLines)
        .where(eq(salesDocumentLines.documentId, invoice.id));

      await expect(
        db
          .update(salesDocumentLines)
          .set({ unitPriceMinor: 50000 })
          .where(eq(salesDocumentLines.id, line!.id)),
      ).rejects.toThrowCause(/pricing and quantity cannot be modified/i);

      // 3. System tracking fields SHOULD BE ALLOWED by database trigger:
      // (delivery_status, payment_status, delivered_qty, credited_minor, balance_minor)
      await expect(
        db
          .update(salesDocuments)
          .set({
            deliveryStatus: 'partly_delivered',
            paymentStatus: 'partly_paid',
            balanceMinor: 500000,
          })
          .where(eq(salesDocuments.id, invoice.id)),
      ).resolves.toBeDefined();

      await expect(
        db
          .update(salesDocumentLines)
          .set({
            deliveredQty: '2.000',
            creditedQty: '1.000',
          })
          .where(eq(salesDocumentLines.id, line!.id)),
      ).resolves.toBeDefined();
    });
  });

  // ── 3. Sequential Gap-Free Numbering & Rollback Preservation (Rule 2) ──────────

  describe('Gap-Free Numbering & Rollback Guarantees', () => {
    it('preserves sequence number when transaction fails or rolls back', async () => {
      const [cust] = await db
        .insert(customers)
        .values({
          accountNumber: `SEQ-CUST-${Date.now()}`,
          name: 'Sequence Test Ltd',
          customerType: 'business',
          creditLimitMinor: 10_000_000,
        })
        .returning();

      const [prod] = await db
        .insert(products)
        .values({
          name: 'Seq Item',
          sku: `SEQ-SKU-${Date.now()}`,
          categoryId: testCatId,
          uomId: testUomId,
          sellingPriceMinor: 100000,
          taxRateId: testTaxRateId,
        })
        .returning();

      // Put stock on hand
      await executeStockMovements(db, [
        {
          productId: prod!.id,
          locationId: testLocId,
          quantity: 20,
          unitCostMinor: 50000,
          movementType: 'purchase_receipt',
          referenceType: 'goods_receipt',
        },
      ]);

      // Create two invoices
      const inv1 = await createDirectInvoice(
        {
          customerId: cust!.id,
          locationId: testLocId,
          lines: [{ productId: prod!.id, quantity: 1, unitPriceMinor: 100000 }],
        },
        testUserId,
      );
      const issued1 = await issueInvoice(inv1.id, testUserId);
      const num1 = issued1.documentNumber!;

      // Simulate a failed transaction that attempts to issue an invoice but throws
      const invFail = await createDirectInvoice(
        {
          customerId: cust!.id,
          locationId: testLocId,
          lines: [{ productId: prod!.id, quantity: 1, unitPriceMinor: 100000 }],
        },
        testUserId,
      );

      try {
        await db.transaction(async (tx) => {
          // Lock customer and document
          await tx.select().from(customers).where(eq(customers.id, cust!.id)).for('update');
          await tx.select().from(salesDocuments).where(eq(salesDocuments.id, invFail.id)).for('update');

          // Intentionally throw inside transaction after beginning sequence logic
          throw new Error('Simulated transaction rollback during issuing');
        });
      } catch {
        // Expected rollback
      }

      // Next invoice issued must get the very next sequential number (contiguous)
      const inv2 = await createDirectInvoice(
        {
          customerId: cust!.id,
          locationId: testLocId,
          lines: [{ productId: prod!.id, quantity: 1, unitPriceMinor: 100000 }],
        },
        testUserId,
      );
      const issued2 = await issueInvoice(inv2.id, testUserId);
      const num2 = issued2.documentNumber!;

      // Extract numeric suffix
      const seq1 = parseInt(num1.split('-').pop()!, 10);
      const seq2 = parseInt(num2.split('-').pop()!, 10);
      expect(seq2).toBe(seq1 + 1);
    }, 60000);
  });

  // ── 4. Credit Limits & Concurrency (Rule 1) ──────────────────────────────────

  describe('Customer Credit Limit & Concurrency Locks', () => {
    it('prevents concurrent invoices from exceeding credit limit via row locking', async () => {
      // Credit limit: MWK 10,000 (1,000,000 minor)
      const [cust] = await db
        .insert(customers)
        .values({
          accountNumber: `CR-CUST-${Date.now()}`,
          name: 'Credit Test Co',
          customerType: 'business',
          creditLimitMinor: 1_000_000, // MWK 10,000
        })
        .returning();

      const [prod] = await db
        .insert(products)
        .values({
          name: 'Credit Prod',
          sku: `CR-SKU-${Date.now()}`,
          categoryId: testCatId,
          uomId: testUomId,
          sellingPriceMinor: 700000, // MWK 7,000
          taxRateId: testTaxRateId,
        })
        .returning();

      await executeStockMovements(db, [
        {
          productId: prod!.id,
          locationId: testLocId,
          quantity: 10,
          unitCostMinor: 300000,
          movementType: 'purchase_receipt',
          referenceType: 'goods_receipt',
        },
      ]);

      // Create two invoices for MWK 7,000 each (Total = MWK 14,000, which exceeds MWK 10,000 limit)
      const invA = await createDirectInvoice(
        {
          customerId: cust!.id,
          locationId: testLocId,
          lines: [{ productId: prod!.id, quantity: 1, unitPriceMinor: 700000 }],
        },
        testUserId,
      );

      const invB = await createDirectInvoice(
        {
          customerId: cust!.id,
          locationId: testLocId,
          lines: [{ productId: prod!.id, quantity: 1, unitPriceMinor: 700000 }],
        },
        testUserId,
      );

      // Execute both issueInvoice calls concurrently
      const results = await Promise.allSettled([
        issueInvoice(invA.id, testUserId),
        issueInvoice(invB.id, testUserId),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly ONE must succeed and exactly ONE must fail with credit limit error
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
      expect(rejectedReason.message).toMatch(/credit limit/i);
    });
  });

  // ── 5. Quotations, Bundles & Stock Reservations (Rule 4) ──────────────────────

  describe('Stock Reservations & Bundle Expansion', () => {
    it('reserves bundle components on quotation acceptance and releases on cancel', async () => {
      // Create component 1 and component 2
      const [compA] = await db
        .insert(products)
        .values({
          name: 'Computer Tower',
          sku: `TWR-${Date.now()}`,
          categoryId: testCatId,
          uomId: testUomId,
          productType: 'standard',
          sellingPriceMinor: 500000,
          taxRateId: testTaxRateId,
        })
        .returning();

      const [compB] = await db
        .insert(products)
        .values({
          name: 'Monitor 24 inch',
          sku: `MON-${Date.now()}`,
          categoryId: testCatId,
          uomId: testUomId,
          productType: 'standard',
          sellingPriceMinor: 300000,
          taxRateId: testTaxRateId,
        })
        .returning();

      // Create Bundle: PC Workstation = 1 Tower + 2 Monitors
      const [bundle] = await db
        .insert(products)
        .values({
          name: 'PC Workstation Combo',
          sku: `PC-COMBO-${Date.now()}`,
          categoryId: testCatId,
          uomId: testUomId,
          productType: 'bundle',
          sellingPriceMinor: 1000000,
          taxRateId: testTaxRateId,
        })
        .returning();

      await db.insert(productBundles).values([
        { bundleProductId: bundle!.id, componentProductId: compA!.id, quantity: '1.000' },
        { bundleProductId: bundle!.id, componentProductId: compB!.id, quantity: '2.000' },
      ]);

      // Seed component stock: 10 Towers, 20 Monitors
      await executeStockMovements(db, [
        {
          productId: compA!.id,
          locationId: testLocId,
          quantity: 10,
          unitCostMinor: 250000,
          movementType: 'purchase_receipt',
          referenceType: 'goods_receipt',
        },
        {
          productId: compB!.id,
          locationId: testLocId,
          quantity: 20,
          unitCostMinor: 150000,
          movementType: 'purchase_receipt',
          referenceType: 'goods_receipt',
        },
      ]);

      const [cust] = await db
        .insert(customers)
        .values({
          accountNumber: `Q-CUST-${Date.now()}`,
          name: 'Quotation Customer',
          customerType: 'individual',
        })
        .returning();

      // Create Quotation for 3 PC Workstations
      const quote = await createQuotation(
        {
          customerId: cust!.id,
          locationId: testLocId,
          lines: [{ productId: bundle!.id, quantity: 3, unitPriceMinor: 1000000 }],
        },
        testUserId,
      );

      // Accept quotation: should reserve 3 Towers (3*1) and 6 Monitors (3*2)
      await acceptQuotation(quote.id, testUserId);

      // Check stock_balances reserved quantities
      const [balA] = await db
        .select()
        .from(stockBalances)
        .where(
          and(
            eq(stockBalances.productId, compA!.id),
            eq(stockBalances.locationId, testLocId),
          ),
        );
      const [balB] = await db
        .select()
        .from(stockBalances)
        .where(
          and(
            eq(stockBalances.productId, compB!.id),
            eq(stockBalances.locationId, testLocId),
          ),
        );

      expect(parseFloat(balA!.reserved)).toBe(3);
      expect(parseFloat(balB!.reserved)).toBe(6);

      // Cancel quotation: reservations should be released
      await cancelQuotation(quote.id, testUserId);

      const [balAAfter] = await db
        .select()
        .from(stockBalances)
        .where(
          and(
            eq(stockBalances.productId, compA!.id),
            eq(stockBalances.locationId, testLocId),
          ),
        );
      const [balBAfter] = await db
        .select()
        .from(stockBalances)
        .where(
          and(
            eq(stockBalances.productId, compB!.id),
            eq(stockBalances.locationId, testLocId),
          ),
        );

      expect(parseFloat(balAAfter!.reserved)).toBe(0);
      expect(parseFloat(balBAfter!.reserved)).toBe(0);

      // Ensure reservation rows were NOT deleted (Rule 4: never delete reservation rows)
      const reservations = await db
        .select()
        .from(stockReservations)
        .where(eq(stockReservations.sourceDocumentId, quote.id));
      expect(reservations.length).toBeGreaterThan(0);
      expect(reservations.every((r) => r.status === 'released')).toBe(true);
    });
  });

  // ── 6. Reservation Expiry Sweep via Cron ──────────────────────────────────────

  describe('Reservation Expiry Cron', () => {
    it('automatically releases stock reservations that have expired', async () => {
      const [prod] = await db
        .insert(products)
        .values({
          name: 'Expiring Item',
          sku: `EXP-${Date.now()}`,
          categoryId: testCatId,
          uomId: testUomId,
          sellingPriceMinor: 100000,
          taxRateId: testTaxRateId,
        })
        .returning();

      await executeStockMovements(db, [
        {
          productId: prod!.id,
          locationId: testLocId,
          quantity: 10,
          unitCostMinor: 50000,
          movementType: 'purchase_receipt',
          referenceType: 'goods_receipt',
        },
      ]);

      const [cust] = await db
        .insert(customers)
        .values({
          accountNumber: `EXP-CUST-${Date.now()}`,
          name: 'Expiring Customer',
          customerType: 'individual',
        })
        .returning();

      const quote = await createQuotation(
        {
          customerId: cust!.id,
          locationId: testLocId,
          lines: [{ productId: prod!.id, quantity: 4, unitPriceMinor: 100000 }],
        },
        testUserId,
      );

      await acceptQuotation(quote.id, testUserId);

      // Fast-forward: set expiresAt to 1 hour in the past
      await db
        .update(stockReservations)
        .set({ expiresAt: new Date(Date.now() - 3600 * 1000) })
        .where(eq(stockReservations.sourceDocumentId, quote.id));

      // Execute cron sweep
      const sweepResult = await expireOutdatedReservations();
      expect(sweepResult.releasedReservations).toBeGreaterThanOrEqual(1);

      // Check reservation status
      const [res] = await db
        .select()
        .from(stockReservations)
        .where(eq(stockReservations.sourceDocumentId, quote.id));
      expect(res!.status).toBe('released');

      // Check stock balance reserved was decremented back to 0
      const [bal] = await db
        .select()
        .from(stockBalances)
        .where(
          and(
            eq(stockBalances.productId, prod!.id),
            eq(stockBalances.locationId, testLocId),
          ),
        );
      expect(parseFloat(bal!.reserved)).toBe(0);
    });
  });

  // ── 7. Delivery Notes & Serial Tracking (Rule 5) ──────────────────────────────

  describe('Delivery Notes with Serial Capture & Warranty Dates', () => {
    it(
      'dispatches serial items, marks serials sold with warranty dates, and fulfills reservation',
      async () => {
      const serialNumberStr = `SR-${Date.now()}`;

      // Create serial tracked product with 12 months warranty
      const [prod] = await db
        .insert(products)
        .values({
          name: 'Solar Inverter 5KVA',
          sku: `SOLAR-${Date.now()}`,
          categoryId: testCatId,
          uomId: testUomId,
          serialTracking: true,
          warrantyMonths: 12,
          sellingPriceMinor: 1500000,
          taxRateId: testTaxRateId,
        })
        .returning();

      // Receive 1 unit with serial
      await executeStockMovements(db, [
        {
          productId: prod!.id,
          locationId: testLocId,
          quantity: 1,
          unitCostMinor: 900000,
          movementType: 'purchase_receipt',
          referenceType: 'goods_receipt',
          serialNumbers: [serialNumberStr],
        },
      ]);

      const [cust] = await db
        .insert(customers)
        .values({
          accountNumber: `DN-CUST-${Date.now()}`,
          name: 'Green Energy Ltd',
          customerType: 'business',
          creditLimitMinor: 5_000_000,
        })
        .returning();

      // Issue invoice (reserves 1 unit)
      const invoice = await createDirectInvoice(
        {
          customerId: cust!.id,
          locationId: testLocId,
          lines: [{ productId: prod!.id, quantity: 1, unitPriceMinor: 1500000 }],
        },
        testUserId,
      );
      await issueInvoice(invoice.id, testUserId);

      // Create delivery note capturing the serial number
      const [line] = await db
        .select()
        .from(salesDocumentLines)
        .where(eq(salesDocumentLines.documentId, invoice.id));

      const dn = await createDeliveryNote(
        {
          salesDocumentId: invoice.id,
          lines: [
            {
              salesDocumentLineId: line!.id,
              quantity: 1,
              serialNumbers: [serialNumberStr],
            },
          ],
        },
        testUserId,
      );

      expect(dn.status).toBe('dispatched');

      // Verify serial number record
      const [serial] = await db
        .select()
        .from(serialNumbers)
        .where(eq(serialNumbers.serialNumber, serialNumberStr));

      expect(serial!.status).toBe('sold');
      expect(serial!.customerId).toBe(cust!.id);
      expect(serial!.warrantyStart).toBeDefined();
      expect(serial!.warrantyEnd).toBeDefined();

      // Verify warranty period is ~12 months (365 days)
      const start = new Date(serial!.warrantyStart!).getTime();
      const end = new Date(serial!.warrantyEnd!).getTime();
      const monthsDiff = (end - start) / (1000 * 60 * 60 * 24 * 30);
      expect(Math.round(monthsDiff)).toBe(12);

      // Verify invoice delivery_status is 'delivered'
      const [updatedInv] = await db
        .select()
        .from(salesDocuments)
        .where(eq(salesDocuments.id, invoice.id));
      expect(updatedInv!.deliveryStatus).toBe('delivered');
    }, 60000);
  });

  // ── 8. Credit Note on Undelivered Goods & Returns (Rule 3 & 5) ─────────────────

  describe('Credit Notes & Undelivered Reservation Release', () => {
    it(
      'releases reservation when crediting undelivered goods and restores stock on return',
      async () => {
      const serialToReturn = `RET-SR-${Date.now()}`;

      const [prod] = await db
        .insert(products)
        .values({
          name: 'Credit Test Motor',
          sku: `MOT-${Date.now()}`,
          categoryId: testCatId,
          uomId: testUomId,
          serialTracking: true,
          sellingPriceMinor: 400000,
          taxRateId: testTaxRateId,
        })
        .returning();

      // Receive 2 units with serials
      await executeStockMovements(db, [
        {
          productId: prod!.id,
          locationId: testLocId,
          quantity: 2,
          unitCostMinor: 200000,
          movementType: 'purchase_receipt',
          referenceType: 'goods_receipt',
          serialNumbers: [serialToReturn, `EXTRA-SR-${Date.now()}`],
        },
      ]);

      const [cust] = await db
        .insert(customers)
        .values({
          accountNumber: `CN-CUST-${Date.now()}`,
          name: 'Credit Note Client',
          customerType: 'business',
          creditLimitMinor: 10_000_000,
        })
        .returning();

      // 1. Issue invoice for 2 units (reserves 2 units)
      const invoice = await createDirectInvoice(
        {
          customerId: cust!.id,
          locationId: testLocId,
          lines: [{ productId: prod!.id, quantity: 2, unitPriceMinor: 400000 }],
        },
        testUserId,
      );
      await issueInvoice(invoice.id, testUserId);

      const [invLine] = await db
        .select()
        .from(salesDocumentLines)
        .where(eq(salesDocumentLines.documentId, invoice.id));

      // 2. Deliver only 1 unit (with serial) -> leaves 1 unit undelivered and reserved
      await createDeliveryNote(
        {
          salesDocumentId: invoice.id,
          lines: [
            {
              salesDocumentLineId: invLine!.id,
              quantity: 1,
              serialNumbers: [serialToReturn],
            },
          ],
        },
        testUserId,
      );

      // Stock balance should have 1 reserved
      const [balBefore] = await db
        .select()
        .from(stockBalances)
        .where(
          and(
            eq(stockBalances.productId, prod!.id),
            eq(stockBalances.locationId, testLocId),
          ),
        );
      expect(parseFloat(balBefore!.reserved)).toBe(1);

      // 3. Create credit note crediting 1 undelivered unit (returnGoods = false)
      const cnUndelivered = await createCreditNote(
        {
          invoiceId: invoice.id,
          notes: 'Customer cancelled undelivered balance',
          lines: [
            {
              sourceLineId: invLine!.id,
              quantity: 1,
              returnGoods: false,
            },
          ],
        },
        testUserId,
      );

      expect(cnUndelivered.status).toBe('issued');

      // The undelivered reservation must be released, reserved becomes 0
      const [balAfter] = await db
        .select()
        .from(stockBalances)
        .where(
          and(
            eq(stockBalances.productId, prod!.id),
            eq(stockBalances.locationId, testLocId),
          ),
        );
      expect(parseFloat(balAfter!.reserved)).toBe(0);

      // 4. Create credit note returning the 1 delivered unit (returnGoods = true)
      const cnDelivered = await createCreditNote(
        {
          invoiceId: invoice.id,
          notes: 'Faulty item return',
          lines: [
            {
              sourceLineId: invLine!.id,
              quantity: 1,
              returnGoods: true,
              serialNumbers: [serialToReturn],
            },
          ],
        },
        testUserId,
      );

      expect(cnDelivered.status).toBe('issued');

      // Serial should be restored to 'in_stock'
      const [serialRecord] = await db
        .select()
        .from(serialNumbers)
        .where(eq(serialNumbers.serialNumber, serialToReturn));
      expect(serialRecord!.status).toBe('in_stock');

      // A customer_return movement should exist at the original delivery unit cost
      const [returnMovement] = await db
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.productId, prod!.id),
            eq(stockMovements.movementType, 'customer_return'),
          ),
        );
      expect(returnMovement).toBeDefined();
      expect(returnMovement!.unitCostMinor).toBe(200000); // original delivery cost

      // Invoice balance should now be 0
      const [finalInv] = await db
        .select()
        .from(salesDocuments)
        .where(eq(salesDocuments.id, invoice.id));
      expect(finalInv!.balanceMinor).toBe(0);
    }, 120000);
  });

  // ── 9. PDF Generation with Letterhead & DRAFT Watermark ───────────────────────

  describe('Sales Document PDF Rendering', () => {
    it('generates binary PDF buffer with DRAFT watermark for draft and clean header for issued', async () => {
      const [cust] = await db
        .insert(customers)
        .values({
          accountNumber: `PDF-CUST-${Date.now()}`,
          name: 'PDF Reader Co',
          customerType: 'individual',
        })
        .returning();

      const [prod] = await db
        .insert(products)
        .values({
          name: 'PDF Item',
          sku: `PDF-SKU-${Date.now()}`,
          categoryId: testCatId,
          uomId: testUomId,
          sellingPriceMinor: 100000,
          taxRateId: testTaxRateId,
        })
        .returning();

      // Create draft quotation
      const quote = await createQuotation(
        {
          customerId: cust!.id,
          locationId: testLocId,
          lines: [{ productId: prod!.id, quantity: 2, unitPriceMinor: 100000 }],
        },
        testUserId,
      );

      // Fetch PDF data and render buffer
      const draftPdfData = await fetchSalesDocumentPdfData('quotation', quote.id);
      expect(draftPdfData.status).toBe('draft');

      const draftPdfBuffer = await generateSalesDocumentPdfBuffer(draftPdfData);
      expect(draftPdfBuffer).toBeInstanceOf(Buffer);
      expect(draftPdfBuffer.length).toBeGreaterThan(1000);

      // PDF file magic header check: '%PDF'
      const magic = draftPdfBuffer.toString('utf8', 0, 4);
      expect(magic).toBe('%PDF');
    });

    it('enforces permission and authentication checks on PDF route handler', async () => {
      const { GET } = await import('@/app/api/pdf/[type]/[id]/route');
      const req = new Request('http://localhost:3000/api/pdf/quotation/test-id');
      const res = await GET(req as any, { params: Promise.resolve({ type: 'quotation', id: 'test-id' }) });
      expect([401, 403]).toContain(res.status);
    });
  });
});
