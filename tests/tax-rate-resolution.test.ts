/**
 * Tax-Rate Resolution Integration Tests.
 *
 * Verifies Item 9:
 * - Products with product-level tax rates not present in the line-level input set
 *   are correctly pre-fetched and resolved across invoices, quotations, POS, and imports.
 * - Prevents the pre-fetch bug where only line-level taxRateIds were collected.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/server/db';
import {
  products,
  taxRates,
  locations,
  customers,
  unitsOfMeasure,
  roles,
  users,
  posShifts,
  salesDocumentLines,
  quotationLines,
  stockBalances,
} from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { createDirectInvoice } from '@/server/services/sales/invoices';
import { createQuotation } from '@/server/services/sales/quotations';
import { createCounterSale } from '@/server/services/pos/counter-sale';
import { executeStockMovements } from '@/server/services/stock/stock-engine';
import { todayInCompanyTz } from '@/lib/timezone';

describe('Item 9: Tax-Rate Resolution Audit & Pre-fetch Verification', () => {
  let testLocationId: string;
  let testCustomerId: string;
  let testUserId: string;
  let testUomId: string;
  let customTaxRateId: string;
  let customTaxProductId: string;
  let standardTaxProductId: string;

  beforeAll(async () => {
    // 1. Roles & User
    const [adminRole] = await db.select().from(roles).where(eq(roles.name, 'admin'));
    const [user] = await db
      .insert(users)
      .values({
        name: 'Tax Tester',
        email: `tax-tester-${Date.now()}@test.com`,
        passwordHash: 'dummy',
        roleId: adminRole!.id,
      })
      .returning();
    testUserId = user!.id;

    // 2. Location
    const [loc] = await db
      .insert(locations)
      .values({
        name: `Tax Loc ${Date.now()}`,
        code: `TL-${Date.now()}`,
        type: 'outlet',
      })
      .returning();
    testLocationId = loc!.id;

    // 3. Customer
    const [cust] = await db
      .insert(customers)
      .values({
        name: `Tax Customer ${Date.now()}`,
        accountNumber: `TC-${Date.now()}`,
      })
      .returning();
    testCustomerId = cust!.id;

    // 4. UOM
    const [uom] = await db
      .select({ id: unitsOfMeasure.id })
      .from(unitsOfMeasure)
      .where(eq(unitsOfMeasure.code, 'EACH'));
    if (uom) {
      testUomId = uom.id;
    } else {
      const [newUom] = await db
        .insert(unitsOfMeasure)
        .values({ name: 'Each', code: 'EACH', symbol: 'ea' })
        .returning();
      testUomId = newUom!.id;
    }

    // 5. Custom Non-Default Tax Rate (e.g. Zero-rated / Exempt 0%)
    const [cTax] = await db
      .insert(taxRates)
      .values({
        name: `Zero-Rated Exempt ${Date.now()}`,
        rateBasisPoints: 0, // 0.00%
        isDefault: false,
        isActive: true,
      })
      .returning();
    customTaxRateId = cTax!.id;

    // 6. Product A: Product-level custom tax rate
    const [prodA] = await db
      .insert(products)
      .values({
        name: `Exempt Product ${Date.now()}`,
        sku: `SKU-ZERO-${Date.now()}`,
        uomId: testUomId,
        productType: 'standard',
        sellingPriceMinor: 200000, // MWK 2,000.00
        taxRateId: customTaxRateId,
      })
      .returning();
    customTaxProductId = prodA!.id;

    // 7. Product B: Standard Product (no product-level taxRateId -> falls back to default 17.5%)
    const [prodB] = await db
      .insert(products)
      .values({
        name: `Standard Product ${Date.now()}`,
        sku: `SKU-STD-${Date.now()}`,
        uomId: testUomId,
        productType: 'standard',
        sellingPriceMinor: 100000, // MWK 1,000.00
        taxRateId: null,
      })
      .returning();
    standardTaxProductId = prodB!.id;
  });

  it('resolves product-level tax rate in Direct Invoices when taxRateId is omitted from input line', async () => {
    const inv = await createDirectInvoice(
      {
        customerId: testCustomerId,
        locationId: testLocationId,
        lines: [
          // Line 1: Product A has 0% tax, no line-level taxRateId passed
          {
            productId: customTaxProductId,
            quantity: 2,
            unitPriceMinor: 200000,
          },
          // Line 2: Product B uses system default VAT 17.5%
          {
            productId: standardTaxProductId,
            quantity: 1,
            unitPriceMinor: 100000,
          },
        ],
      },
      testUserId,
    );

    const invLines = await db
      .select()
      .from(salesDocumentLines)
      .where(eq(salesDocumentLines.documentId, inv.id));

    expect(invLines).toHaveLength(2);

    const lineA = invLines.find((l) => l.productId === customTaxProductId);
    const lineB = invLines.find((l) => l.productId === standardTaxProductId);

    // Line A must resolve to customTaxRate (0 basis points)
    expect(lineA).toBeDefined();
    expect(lineA!.taxRateId).toBe(customTaxRateId);
    expect(lineA!.taxRateBasisPoints).toBe(0);
    expect(lineA!.taxMinor).toBe(0);
    expect(lineA!.lineTotalMinor).toBe(400000); // 2 * 200,000

    // Line B must resolve to default VAT 17.5% (1750 basis points)
    expect(lineB).toBeDefined();
    expect(lineB!.taxRateBasisPoints).toBe(1750);
    expect(lineB!.taxMinor).toBe(17500); // 100,000 * 17.5%
    expect(lineB!.lineTotalMinor).toBe(117500);

    // Document totals check:
    expect(inv.subtotalMinor).toBe(500000);
    expect(inv.taxMinor).toBe(17500);
    expect(inv.totalMinor).toBe(517500);
  });

  it('resolves product-level tax rate in Quotations when taxRateId is omitted from input line', async () => {
    const quote = await createQuotation(
      {
        customerId: testCustomerId,
        locationId: testLocationId,
        lines: [
          {
            productId: customTaxProductId,
            quantity: 1,
            unitPriceMinor: 200000,
          },
        ],
      },
      testUserId,
    );

    const qLines = await db
      .select()
      .from(quotationLines)
      .where(eq(quotationLines.quotationId, quote.id));

    expect(qLines).toHaveLength(1);
    expect(qLines[0]!.taxRateId).toBe(customTaxRateId);
    expect(qLines[0]!.taxRateBasisPoints).toBe(0);
    expect(quote.taxMinor).toBe(0);
  });

  it('resolves product-level tax rate in POS Counter Sales when taxRateId is omitted from input line', async () => {
    // Ensure sufficient stock at location for POS sale via standard stock ledger opening movement
    await db.transaction(async (tx) => {
      await executeStockMovements(tx, [
        {
          productId: customTaxProductId,
          locationId: testLocationId,
          quantity: '10',
          unitCostMinor: 100000,
          movementType: 'opening',
          referenceType: 'opening_stock',
        },
      ]);
    });

    // Open a POS shift
    const [shift] = await db
      .insert(posShifts)
      .values({
        shiftNumber: `SH-TAX-${Date.now()}`,
        cashierId: testUserId,
        locationId: testLocationId,
        status: 'open',
        openedAt: new Date(),
        openingFloatMinor: 100000,
      })
      .returning();

    const sale = await createCounterSale(
      {
        idempotencyKey: `pos-tax-${Date.now()}`,
        shiftId: shift!.id,
        locationId: testLocationId,
        cashierId: testUserId,
        lines: [
          {
            productId: customTaxProductId,
            quantity: 1,
          },
        ],
        payments: [
          {
            method: 'cash',
            appliedMinor: 200000,
            tenderedMinor: 200000,
          },
        ],
      },
      testUserId,
    );

    expect(sale.invoiceLines).toHaveLength(1);
    const saleLine = sale.invoiceLines[0]!;
    expect(saleLine.taxRateId).toBe(customTaxRateId);
    expect(saleLine.taxRateBasisPoints).toBe(0);
    expect(sale.invoice.taxMinor).toBe(0);
    expect(sale.invoice.totalMinor).toBe(200000);
  });
});
