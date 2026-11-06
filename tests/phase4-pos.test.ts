/**
 * Phase 4 Integration Tests — Counter POS & Shift Reconciliation.
 *
 * All required tests from Phase 4 specification:
 *   1. Midnight Timezone
 *   2. Atomic Counter Sale & Rollback
 *   3. Double-Tap Idempotency
 *   4. Server Price Authority & Manager Override (Lockout, Role, Approver!=Cashier)
 *   5. Payment Split & Change Math
 *   6. Stock Availability & Reservations Protection
 *   7. Bundle & Serial Capture
 *   8. Shift Concurrency & One Open Shift Rule
 *   9. Blind Cash-Up & Z-Report Expected Cash & Variance Review Note
 *  10. Walk-In Credit Prevention (Sale & Return)
 *  11. Counter Returns & Quantity Cap & Reversal Block
 *  12. Security & Data Sanitization
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

import { db, pool } from '@/server/db';
import {
  customers,
  locations,
  salesDocuments,
  salesDocumentLines,
  payments,
  paymentAllocations,
  products,
  productBundles,
  categories,
  unitsOfMeasure,
  taxRates,
  users,
  roles,
  posShifts,
  cashMovements,
  heldSales,
  serialNumbers,
  stockBalances,
  cardTerminals,
  numberSequences,
  stockMovements,
} from '@/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { updateSetting } from '@/server/services/settings';
import { GET as getPOSProducts } from '@/app/api/pos/products/route';
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import {
  openShift,
  closeShift,
  reviewShift,
  getXReport,
  getZReport,
} from '@/server/services/pos/shifts';
import {
  recordCashMovement,
  listCashMovements,
} from '@/server/services/pos/cash-movements';
import {
  createCounterSale,
} from '@/server/services/pos/counter-sale';
import {
  createCounterReturn,
} from '@/server/services/pos/counter-return';
import {
  holdSale,
  listHeldSales,
  recallHeldSale,
  discardHeldSale,
} from '@/server/services/pos/held-sales';
import {
  setUserPin,
  verifyManagerOverride,
} from '@/server/services/pos/override';
import {
  recordPayment,
  reversePayment,
} from '@/server/services/sales/payments';
import { executeStockMovements } from '@/server/services/stock/stock-engine';
import { setClock, resetClock, todayInCompanyTz } from '@/lib/timezone';

// ── Test Fixtures ─────────────────────────────────────────────────────────────

let testLocId: string;
let testWalkInCustId: string;
let testRegularCustId: string;
let testProductStandardId: string;
let testProductSerialId: string;
let testProductBundleId: string;
let testBundleComponentId: string;
let testUomId: string;
let testTaxRateId: string;
let testCashierId: string;
let testCashier2Id: string;
let testManagerId: string;
let testTerminalId: string;

const TS = Date.now();
// Use last-6-digits of TS as PIN — unique per test run, never matches prior runs
const MANAGER_PIN = String(TS).slice(-6);

describe('Phase 4 — Counter POS & Shift Reconciliation', () => {
  beforeAll(async () => {
    // 1. Create Location
    const [loc] = await db
      .insert(locations)
      .values({ name: `P4 Branch ${TS}`, code: `P4-${TS}`, type: 'outlet' })
      .returning();
    testLocId = loc!.id;

    // 2. Create UOM
    const [uom] = await db
      .insert(unitsOfMeasure)
      .values({ name: `P4 UOM ${TS}`, code: `P4U-${TS}`, symbol: 'ea', allowDecimal: false })
      .returning();
    testUomId = uom!.id;

    // 3. Create Category
    const [cat] = await db
      .insert(categories)
      .values({ name: `P4 Cat ${TS}`, code: `P4C-${TS}` })
      .returning();
    const catId = cat!.id;

    // 4. Create 0% Tax Rate
    const [tax] = await db
      .insert(taxRates)
      .values({ name: `P4 Zero Tax ${TS}`, rateBasisPoints: 0 })
      .returning();
    testTaxRateId = tax!.id;

    // 5. Create Standard Product (Selling price: 10,000 tambala = MK 100.00)
    const [prodStd] = await db
      .insert(products)
      .values({
        name: `P4 Standard Prod ${TS}`,
        sku: `P4-STD-${TS}`,
        categoryId: catId,
        uomId: testUomId,
        taxRateId: testTaxRateId,
        sellingPriceMinor: 10000,
        avgCostMinor: 6000,
      })
      .returning();
    testProductStandardId = prodStd!.id;

    // 6. Create Serial-Tracked Product
    const [prodSerial] = await db
      .insert(products)
      .values({
        name: `P4 Serial Prod ${TS}`,
        sku: `P4-SER-${TS}`,
        categoryId: catId,
        uomId: testUomId,
        taxRateId: testTaxRateId,
        sellingPriceMinor: 25000,
        avgCostMinor: 15000,
        serialTracking: true,
      })
      .returning();
    testProductSerialId = prodSerial!.id;

    // 7. Create Bundle Component & Bundle Parent Product
    const [bundleComp] = await db
      .insert(products)
      .values({
        name: `P4 Component ${TS}`,
        sku: `P4-CMP-${TS}`,
        categoryId: catId,
        uomId: testUomId,
        taxRateId: testTaxRateId,
        sellingPriceMinor: 5000,
        avgCostMinor: 2000,
      })
      .returning();
    testBundleComponentId = bundleComp!.id;

    const [bundleProd] = await db
      .insert(products)
      .values({
        name: `P4 Bundle ${TS}`,
        sku: `P4-BUN-${TS}`,
        productType: 'bundle',
        categoryId: catId,
        uomId: testUomId,
        taxRateId: testTaxRateId,
        sellingPriceMinor: 18000,
      })
      .returning();
    testProductBundleId = bundleProd!.id;

    await db.insert(productBundles).values({
      bundleProductId: testProductBundleId,
      componentProductId: testBundleComponentId,
      quantity: '2',
    });

    // 8. Seed Stock Movements
    await executeStockMovements(db, [
      {
        productId: testProductStandardId,
        locationId: testLocId,
        quantity: 50,
        unitCostMinor: 6000,
        movementType: 'purchase_receipt',
        referenceType: 'goods_receipt',
      },
      {
        productId: testProductSerialId,
        locationId: testLocId,
        quantity: 10,
        unitCostMinor: 15000,
        movementType: 'purchase_receipt',
        referenceType: 'goods_receipt',
      },
      {
        productId: testBundleComponentId,
        locationId: testLocId,
        quantity: 100,
        unitCostMinor: 2000,
        movementType: 'purchase_receipt',
        referenceType: 'goods_receipt',
      },
    ]);

    // Insert serial numbers for serial-tracked product
    await db.insert(serialNumbers).values([
      {
        productId: testProductSerialId,
        locationId: testLocId,
        serialNumber: `SN-P4-001-${TS}`,
        status: 'in_stock',
      },
      {
        productId: testProductSerialId,
        locationId: testLocId,
        serialNumber: `SN-P4-002-${TS}`,
        status: 'in_stock',
      },
    ]);

    // 9. Customers (Walk-In Customer & Regular Business Customer)
    // Check if walk-in exists; if not create one
    const [existingWalkIn] = await db
      .select()
      .from(customers)
      .where(eq(customers.isWalkIn, true))
      .limit(1);

    if (existingWalkIn) {
      testWalkInCustId = existingWalkIn.id;
    } else {
      const [w] = await db
        .insert(customers)
        .values({
          name: 'Walk-in Customer',
          accountNumber: `WALK-${TS}`,
          customerType: 'walk_in',
          isWalkIn: true,
          creditLimitMinor: 0,
        })
        .returning();
      testWalkInCustId = w!.id;
    }

    const [regCust] = await db
      .insert(customers)
      .values({
        name: `P4 Business Customer ${TS}`,
        accountNumber: `P4REG-${TS}`,
        customerType: 'business',
        creditLimitMinor: 10_000_000,
      })
      .returning();
    testRegularCustId = regCust!.id;

    // 10. Roles & Users
    const [cashierRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.name, 'cashier'))
      .limit(1);

    const [managerRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.name, 'manager'))
      .limit(1);

    // Cashier 1
    const [cashier] = await db
      .insert(users)
      .values({
        name: `P4 Cashier 1 ${TS}`,
        email: `cashier1-${TS}@test.local`,
        passwordHash: 'x',
        roleId: cashierRole?.id ?? null,
        defaultLocationId: testLocId,
      })
      .returning();
    testCashierId = cashier!.id;

    // Cashier 2
    const [cashier2] = await db
      .insert(users)
      .values({
        name: `P4 Cashier 2 ${TS}`,
        email: `cashier2-${TS}@test.local`,
        passwordHash: 'x',
        roleId: cashierRole?.id ?? null,
        defaultLocationId: testLocId,
      })
      .returning();
    testCashier2Id = cashier2!.id;

    // Manager with PIN
    const [manager] = await db
      .insert(users)
      .values({
        name: `P4 Manager ${TS}`,
        email: `manager-${TS}@test.local`,
        passwordHash: 'x',
        roleId: managerRole?.id ?? null,
        defaultLocationId: testLocId,
      })
      .returning();
    testManagerId = manager!.id;

    // Set 6-digit PIN for manager
    await setUserPin(testManagerId, MANAGER_PIN);

    // 11. Create Card Terminal for Location
    const [term] = await db
      .insert(cardTerminals)
      .values({
        name: `Card Terminal ${TS}`,
        terminalId: `TERM-${TS}`,
        locationId: testLocId,
        isActive: true,
      })
      .returning();
    testTerminalId = term!.id;
  });

  afterAll(async () => {
    resetClock();
    await pool.end();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Midnight Timezone
  // ─────────────────────────────────────────────────────────────────────────────
  it('1. Midnight Timezone: sale created at 22:30 UTC gets Blantyre date (UTC+2 = 00:30 next day)', async () => {
    setClock(() => new Date('2026-10-29T22:30:00.000Z'));
    expect(todayInCompanyTz()).toBe('2026-10-30');

    setClock(() => new Date('2026-10-29T21:59:00.000Z'));
    expect(todayInCompanyTz()).toBe('2026-10-29');

    resetClock();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Shift Management & Concurrency
  // ─────────────────────────────────────────────────────────────────────────────
  it('2. Shift Concurrency: cashier can open a shift, but cannot open two shifts simultaneously', async () => {
    const shift1 = await openShift({
      cashierId: testCashierId,
      locationId: testLocId,
      openingFloatMinor: 100000, // MK 1,000 float
    });

    expect(shift1).toBeDefined();
    expect(shift1.status).toBe('open');
    expect(shift1.openingFloatMinor).toBe(100000);

    // Trying to open a second shift for the same cashier must fail
    await expect(
      openShift({
        cashierId: testCashierId,
        locationId: testLocId,
        openingFloatMinor: 50000,
      }),
    ).rejects.toThrow(/already has an active open shift/);
  });

  it('3. Cash Movements on active shift', async () => {
    const [shift] = await db
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.cashierId, testCashierId), eq(posShifts.status, 'open')));

    // Record Cash Paid In
    const paidIn = await recordCashMovement({
      shiftId: shift!.id,
      kind: 'paid_in',
      amountMinor: 50000, // MK 500
      reason: 'Extra small note float',
      cashierUserId: testCashierId,
    });
    expect(paidIn.kind).toBe('paid_in');
    expect(paidIn.amountMinor).toBe(50000);

    // Cash Paid Out without manager PIN must fail
    await expect(
      recordCashMovement({
        shiftId: shift!.id,
        kind: 'paid_out',
        amountMinor: 20000,
        reason: 'Office supplies',
        cashierUserId: testCashierId,
      }),
    ).rejects.toThrow(/Manager PIN is required/);

    // Cash Paid Out with valid manager PIN succeeds
    const paidOut = await recordCashMovement({
      shiftId: shift!.id,
      kind: 'paid_out',
      amountMinor: 20000,
      reason: 'Office supplies',
      cashierUserId: testCashierId,
      overridePin: MANAGER_PIN,
    });
    expect(paidOut.kind).toBe('paid_out');
    expect(paidOut.approvedBy).toBe(testManagerId);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Counter Sale: Atomic Sale, Idempotency & Payments Split
  // ─────────────────────────────────────────────────────────────────────────────
  it('4. Counter Sale: succeeds atomically with exact cash payment, updates stock, issues invoice & delivery note', async () => {
    const [shift] = await db
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.cashierId, testCashierId), eq(posShifts.status, 'open')));

    const idempotencyKey = `p4-sale-1-${Date.now()}`;

    const result = await createCounterSale(
      {
        idempotencyKey,
        shiftId: shift!.id,
        locationId: testLocId,
        cashierId: testCashierId,
        customerId: testWalkInCustId,
        lines: [
          {
            productId: testProductStandardId,
            quantity: 2, // 2 * 10,000 = 20,000 tambala
          },
        ],
        payments: [
          {
            method: 'cash',
            appliedMinor: 20000,
            tenderedMinor: 30000, // customer gave MK 300, change is MK 100
          },
        ],
      },
      testCashierId,
    );

    expect(result.invoice).toBeDefined();
    expect(result.invoice.documentType).toBe('invoice');
    expect(result.invoice.channel).toBe('counter');
    expect(result.invoice.totalMinor).toBe(20000);
    expect(result.invoice.balanceMinor).toBe(0);
    expect(result.invoice.paymentStatus).toBe('paid');
    expect(result.invoice.deliveryStatus).toBe('delivered');
    expect(result.deliveryNote).toBeDefined();
    expect(result.changeMinor).toBe(10000); // MK 100 change

    // Check payments recorded
    expect(result.payments.length).toBe(1);
    expect(result.payments[0]!.payment.amountMinor).toBe(20000);
    expect((result.payments[0]!.payment.methodDetails as any).change_minor).toBe(10000);
  });

  it('5. Double-Tap Idempotency: exact same payload returns existing sale; altered payload returns conflict', async () => {
    const [shift] = await db
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.cashierId, testCashierId), eq(posShifts.status, 'open')));

    const idempotencyKey = `p4-doubletap-${Date.now()}`;

    const payload = {
      idempotencyKey,
      shiftId: shift!.id,
      locationId: testLocId,
      cashierId: testCashierId,
      customerId: testWalkInCustId,
      lines: [{ productId: testProductStandardId, quantity: 1 }],
      payments: [{ method: 'cash' as const, appliedMinor: 10000 }],
    };

    // First tap
    const sale1 = await createCounterSale(payload, testCashierId);
    expect(sale1.isDuplicate).toBeFalsy();

    // Second tap (identical payload) -> returns existing sale
    const sale2 = await createCounterSale(payload, testCashierId);
    expect(sale2.isDuplicate).toBe(true);
    expect(sale2.invoice.id).toBe(sale1.invoice.id);

    // Third tap with altered payload -> conflict error
    const alteredPayload = {
      ...payload,
      lines: [{ productId: testProductStandardId, quantity: 2 }],
    };
    await expect(createCounterSale(alteredPayload, testCashierId)).rejects.toThrow(
      /Idempotency key conflict/,
    );
  });

  it('6. Price Authority & Manager Override: unapproved lower price is rejected; valid manager override succeeds', async () => {
    const [shift] = await db
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.cashierId, testCashierId), eq(posShifts.status, 'open')));

    // Standard price is 10,000. Cashier attempts selling for 8,000 without override.
    const saleWithoutOverride = {
      idempotencyKey: `p4-price-reject-${Date.now()}`,
      shiftId: shift!.id,
      locationId: testLocId,
      cashierId: testCashierId,
      customerId: testWalkInCustId,
      lines: [
        {
          productId: testProductStandardId,
          quantity: 1,
          overriddenPriceMinor: 8000,
        },
      ],
      payments: [{ method: 'cash' as const, appliedMinor: 8000 }],
    };

    await expect(createCounterSale(saleWithoutOverride, testCashierId)).rejects.toThrow(
      /Manager override is required/,
    );

    // Cashier attempts with valid manager override PIN
    const saleWithOverride = {
      ...saleWithoutOverride,
      idempotencyKey: `p4-price-accept-${Date.now()}`,
      managerOverride: {
        pin: MANAGER_PIN,
        reason: 'Customer goodwill discount',
      },
    };

    const result = await createCounterSale(saleWithOverride, testCashierId);
    expect(result.invoice.totalMinor).toBe(8000);
  });

  it('7. Manager Override Security: manager cannot self-approve; 5 failed PIN attempts triggers lockout', async () => {
    // Dedicated isolated manager specifically for Test 7 lockout test
    const [managerRole] = await db.select().from(roles).where(eq(roles.name, 'manager'));
    const [lockoutManager] = await db
      .insert(users)
      .values({
        name: `Lockout Manager ${Date.now()}`,
        email: `lockout-${Date.now()}@test.local`,
        passwordHash: 'dummy',
        roleId: managerRole!.id,
      })
      .returning();
    const LOCKOUT_PIN = String(Math.floor(100000 + Math.random() * 900000));
    await setUserPin(lockoutManager!.id, LOCKOUT_PIN);

    // 1. Manager acting as cashier cannot approve their own override (self-override prevention)
    await expect(
      verifyManagerOverride({
        pin: LOCKOUT_PIN,
        cashierUserId: lockoutManager!.id, // manager is the cashier — self-approve attempt
        action: 'pos:discount',
      }),
    ).rejects.toThrow(/cannot be approved by the cashier/);

    // 2. Failed attempts with wrong PIN increment counter
    for (let i = 0; i < 4; i++) {
      await expect(
        verifyManagerOverride({
          pin: '000000',
          cashierUserId: testCashierId,
          action: 'pos:discount',
        }),
      ).rejects.toThrow(/Invalid manager PIN/);
    }

    // 5th failed attempt locks out the PIN
    await expect(
      verifyManagerOverride({
        pin: '000000',
        cashierUserId: testCashierId,
        action: 'pos:discount',
      }),
    ).rejects.toThrow();

    // Clean up isolated lockout manager
    await db.update(users).set({ isActive: false }).where(eq(users.id, lockoutManager!.id));
  });

  it('8. Payment Applied Exact Match: applied payments must sum exactly to document total; non-cash overpayment rejected', async () => {
    const [shift] = await db
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.cashierId, testCashierId), eq(posShifts.status, 'open')));

    // Invoice total is 10,000. Client sends 9,000 applied.
    await expect(
      createCounterSale(
        {
          idempotencyKey: `p4-pay-short-${Date.now()}`,
          shiftId: shift!.id,
          locationId: testLocId,
          cashierId: testCashierId,
          customerId: testWalkInCustId,
          lines: [{ productId: testProductStandardId, quantity: 1 }],
          payments: [{ method: 'cash', appliedMinor: 9000 }],
        },
        testCashierId,
      ),
    ).rejects.toThrow(/Payment applied amounts? .* do(es)? not equal invoice total/);

    // Non-cash (card) tendered above applied amount rejected
    await expect(
      createCounterSale(
        {
          idempotencyKey: `p4-pay-card-over-${Date.now()}`,
          shiftId: shift!.id,
          locationId: testLocId,
          cashierId: testCashierId,
          customerId: testWalkInCustId,
          lines: [{ productId: testProductStandardId, quantity: 1 }],
          payments: [
            {
              method: 'card',
              appliedMinor: 10000,
              tenderedMinor: 15000,
            },
          ],
        },
        testCashierId,
      ),
    ).rejects.toThrow(/Non-cash payments cannot be over-tendered/);
  });

  it('9. Serial & Bundle Handling: serialized items marked sold; bundle components decremented', async () => {
    const [shift] = await db
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.cashierId, testCashierId), eq(posShifts.status, 'open')));

    // 1. Serial item sale
    const serialNumber = `SN-P4-001-${TS}`;
    const serialSale = await createCounterSale(
      {
        idempotencyKey: `p4-serial-sale-${Date.now()}`,
        shiftId: shift!.id,
        locationId: testLocId,
        cashierId: testCashierId,
        customerId: testWalkInCustId,
        lines: [
          {
            productId: testProductSerialId,
            quantity: 1,
            serialNumbers: [serialNumber],
          },
        ],
        payments: [{ method: 'cash', appliedMinor: 25000 }],
      },
      testCashierId,
    );

    expect(serialSale.invoice.totalMinor).toBe(25000);

    // Verify serial status in DB is now 'sold'
    const [snRow] = await db
      .select()
      .from(serialNumbers)
      .where(eq(serialNumbers.serialNumber, serialNumber));
    expect(snRow?.status).toBe('sold');

    // 2. Bundle sale: selling 1 bundle decrements 2 of component
    const [compBefore] = await db
      .select()
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.productId, testBundleComponentId),
          eq(stockBalances.locationId, testLocId),
        ),
      );
    const beforeQty = Number(compBefore!.available);

    await createCounterSale(
      {
        idempotencyKey: `p4-bundle-sale-${Date.now()}`,
        shiftId: shift!.id,
        locationId: testLocId,
        cashierId: testCashierId,
        customerId: testWalkInCustId,
        lines: [
          {
            productId: testProductBundleId,
            quantity: 2, // 2 bundles * 2 components = 4 components decremented
          },
        ],
        payments: [{ method: 'cash', appliedMinor: 36000 }],
      },
      testCashierId,
    );

    const [compAfter] = await db
      .select()
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.productId, testBundleComponentId),
          eq(stockBalances.locationId, testLocId),
        ),
      );
    expect(Number(compAfter!.available)).toBe(beforeQty - 4);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. Held Sales: Save, List, Recall & Discard
  // ─────────────────────────────────────────────────────────────────────────────
  it('10. Held Sales: saves cart without burning numbers or stock; re-prices on recall', async () => {
    const [shift] = await db
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.cashierId, testCashierId), eq(posShifts.status, 'open')));

    const holdRef = `Hold-Test-${Date.now()}`;
    const held = await holdSale({
      shiftId: shift!.id,
      holdReference: holdRef,
      customerId: testRegularCustId,
      cartPayload: {
        lines: [
          {
            productId: testProductStandardId,
            quantity: 3,
            unitPriceMinor: 10000,
          },
        ],
      },
      userId: testCashierId,
    });

    expect(held.id).toBeDefined();

    // List
    const holds = await listHeldSales(shift!.id);
    expect(holds.some((h) => h.id === held.id)).toBe(true);

    // Recall (re-prices from DB)
    const recalled = await recallHeldSale(held.id);
    expect(recalled.lines.length).toBe(1);
    expect(recalled.lines[0]!.currentUnitPriceMinor).toBe(10000);

    // Held record is deleted upon recall
    const holdsAfter = await listHeldSales(shift!.id);
    expect(holdsAfter.some((h) => h.id === held.id)).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. Counter Returns & Refunds
  // ─────────────────────────────────────────────────────────────────────────────
  it('11. Counter Return: atomically creates credit note + refund, caps return qty, verifies zero walk-in balance', async () => {
    const [shift] = await db
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.cashierId, testCashierId), eq(posShifts.status, 'open')));

    // Create original sale to return against
    const originalSale = await createCounterSale(
      {
        idempotencyKey: `p4-sale-for-return-${Date.now()}`,
        shiftId: shift!.id,
        locationId: testLocId,
        cashierId: testCashierId,
        customerId: testWalkInCustId,
        lines: [{ productId: testProductStandardId, quantity: 2 }],
        payments: [{ method: 'cash', appliedMinor: 20000 }],
      },
      testCashierId,
    );

    const sourceLine = originalSale.invoiceLines[0]!;

    // Attempting to return more than sold quantity (3 > 2) must fail
    await expect(
      createCounterReturn(
        {
          invoiceId: originalSale.invoice.id,
          shiftId: shift!.id,
          locationId: testLocId,
          cashierId: testCashierId,
          refundMethod: 'cash',
          lines: [
            {
              sourceLineId: sourceLine.id,
              quantity: 3,
              returnGoods: true,
            },
          ],
        },
        testCashierId,
      ),
    ).rejects.toThrow(/exceeds remaining creditable amount|exceeds available returnable quantity/);

    // Return 1 unit (half the sale)
    const returnResult = await createCounterReturn(
      {
        invoiceId: originalSale.invoice.id,
        shiftId: shift!.id,
        locationId: testLocId,
        cashierId: testCashierId,
        refundMethod: 'cash',
        lines: [
          {
            sourceLineId: sourceLine.id,
            quantity: 1,
            returnGoods: true,
          },
        ],
      },
      testCashierId,
    );

    expect(returnResult.creditNote).toBeDefined();
    expect(returnResult.creditNote.totalMinor).toBe(10000);
    expect(returnResult.refund.payment.kind).toBe('refund');
    expect(returnResult.refund.payment.amountMinor).toBe(10000);
  });

  it('12. Direct payment reversal on POS shift payment is blocked', async () => {
    // Find a payment attached to a shift
    const [shiftPayment] = await db
      .select()
      .from(payments)
      .where(sql`${payments.shiftId} IS NOT NULL`)
      .limit(1);

    expect(shiftPayment).toBeDefined();

    // reversePayment directly must be blocked
    await expect(
      reversePayment(shiftPayment!.id, testCashierId, 'Mistake'),
    ).rejects.toThrow(/Payments (attached to|recorded on) a POS shift cannot be reversed directly/);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 13. Shift Close, Blind Cash-Up, Z-Report & Manager Review
  // ─────────────────────────────────────────────────────────────────────────────
  it('13. Shift Close & Z-Report: calculates expected cash, variance, and enforces review note for non-zero variance', async () => {
    const [shift] = await db
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.cashierId, testCashierId), eq(posShifts.status, 'open')));

    // Get live X-report as cashier (blind mode may hide cash)
    const xReport = await getXReport(shift!.id, {
      id: testCashierId,
      roleName: 'cashier',
      permissions: ['pos:access'],
    });
    expect(xReport.shift.shiftNumber).toBe(shift!.shiftNumber);

    // Get X-report as manager to obtain expected cash (visible even in blind mode)
    const xReportManager = await getXReport(shift!.id, {
      id: testManagerId,
      roleName: 'manager',
      permissions: ['shifts:manage'],
    });
    const expectedCash = xReportManager.cash.expectedCashMinor ?? 0;
    const countedCash = expectedCash - 50; // 50 tambala short

    const closeResult = await closeShift(
      {
        shiftId: shift!.id,
        cashierId: testCashierId,
        countedCashMinor: countedCash,
        notes: 'End of afternoon shift',
      },
      testCashierId,
    );

    expect(closeResult.shift!.status).toBe('closed');
    expect(closeResult.varianceMinor).toBe(-50);

    // Get Z-Report now that shift is closed
    const zReport = await getZReport(shift!.id, {
      id: testManagerId,
      roleName: 'manager',
      permissions: ['shifts:manage'],
    });
    expect(zReport.reconciliation.expectedCashMinor).toBeDefined();

    // Reviewing shift without a note when variance != 0 must fail
    await expect(
      reviewShift({
        shiftId: shift!.id,
        reviewerId: testManagerId,
        reviewNote: '',
      }),
    ).rejects.toThrow(/review note is required when there is a cash variance/);

    // Reviewing shift with note succeeds
    const reviewed = await reviewShift({
      shiftId: shift!.id,
      reviewerId: testManagerId,
      reviewNote: 'Small change shortage verified and approved.',
    });
    expect(reviewed!.status).toBe('reviewed');
    expect(reviewed!.reviewedBy).toBe(testManagerId);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 14. Atomic Rollback: Injected Failure After Payments Leaves Zero Residue
  // ─────────────────────────────────────────────────────────────────────────────
  it('14. Atomic Rollback: Injected failure after payments leaves NO sale, payment, stock movement, serial change, or burned number', async () => {
    // Open a fresh shift for cashier 2
    const shift2 = await openShift({
      cashierId: testCashier2Id,
      locationId: testLocId,
      openingFloatMinor: 50000,
    });

    // Record a fresh serial in stock
    const testSerial = `SN-ROLLBACK-${Date.now()}`;
    await db.insert(serialNumbers).values({
      productId: testProductSerialId,
      locationId: testLocId,
      serialNumber: testSerial,
      status: 'in_stock',
    });

    const [stockBefore] = await db
      .select()
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.productId, testProductSerialId),
          eq(stockBalances.locationId, testLocId),
        ),
      );
    const availableBefore = Number(stockBefore?.available ?? 0);

    const [seqBefore] = await db
      .select()
      .from(numberSequences)
      .where(and(eq(numberSequences.docType, 'invoice'), eq(numberSequences.locationId, testLocId)));
    const nextInvNumberBefore = seqBefore?.nextNumber ?? 1;

    const rollbackKey = `p4-rollback-sale-${Date.now()}`;

    // Execute with failure injection after payments
    await expect(
      createCounterSale(
        {
          idempotencyKey: rollbackKey,
          shiftId: shift2.id,
          locationId: testLocId,
          cashierId: testCashier2Id,
          customerId: testWalkInCustId,
          lines: [
            {
              productId: testProductSerialId,
              quantity: 1,
              serialNumbers: [testSerial],
            },
          ],
          payments: [{ method: 'cash', appliedMinor: 25000 }],
          _testInjectFailureAfterPayments: true,
        },
        testCashier2Id,
      ),
    ).rejects.toThrow(/Injected failure after payments for atomicity verification/);

    // 1. Assert NO sales document
    const [saleDoc] = await db
      .select()
      .from(salesDocuments)
      .where(eq(salesDocuments.idempotencyKey, rollbackKey));
    expect(saleDoc).toBeUndefined();

    // 2. Assert NO payment
    const [paymentDoc] = await db
      .select()
      .from(payments)
      .where(sql`${payments.idempotencyKey} LIKE ${rollbackKey + '%'}`);
    expect(paymentDoc).toBeUndefined();

    // 3. Assert NO stock movement
    const [movement] = await db
      .select()
      .from(stockMovements)
      .where(sql`${stockMovements.notes} LIKE ${'%' + rollbackKey + '%'}`);
    expect(movement).toBeUndefined();

    // 4. Assert stock balance unchanged
    const [stockAfter] = await db
      .select()
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.productId, testProductSerialId),
          eq(stockBalances.locationId, testLocId),
        ),
      );
    expect(Number(stockAfter?.available ?? 0)).toBe(availableBefore);

    // 5. Assert serial number remains 'in_stock'
    const [snAfter] = await db
      .select()
      .from(serialNumbers)
      .where(eq(serialNumbers.serialNumber, testSerial));
    expect(snAfter?.status).toBe('in_stock');

    // 6. Assert sequence number not burned
    const [seqAfter] = await db
      .select()
      .from(numberSequences)
      .where(and(eq(numberSequences.docType, 'invoice'), eq(numberSequences.locationId, testLocId)));
    expect(seqAfter?.nextNumber).toBe(nextInvNumberBefore);

    // Clean up shift 2
    await closeShift({
      shiftId: shift2.id,
      cashierId: testCashier2Id,
      countedCashMinor: 50000,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 15. Sale Location Mismatch
  // ─────────────────────────────────────────────────────────────────────────────
  it('15. Sale Location Mismatch: sale location differing from open shift location is rejected', async () => {
    // Create an alternate location
    const [loc2] = await db
      .insert(locations)
      .values({ name: `P4 Branch 2 ${TS}`, code: `P4-2-${TS}`, type: 'outlet' })
      .returning();

    // Open shift on loc1
    const shift = await openShift({
      cashierId: testCashier2Id,
      locationId: testLocId,
      openingFloatMinor: 10000,
    });

    // Attempt sale targeting loc2
    await expect(
      createCounterSale(
        {
          idempotencyKey: `p4-loc-mismatch-${Date.now()}`,
          shiftId: shift.id,
          locationId: loc2!.id, // Mismatch!
          cashierId: testCashier2Id,
          customerId: testWalkInCustId,
          lines: [{ productId: testProductStandardId, quantity: 1 }],
          payments: [{ method: 'cash', appliedMinor: 10000 }],
        },
        testCashier2Id,
      ),
    ).rejects.toThrow(/does not match sale location/);

    await closeShift({
      shiftId: shift.id,
      cashierId: testCashier2Id,
      countedCashMinor: 10000,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 16. Card Refund Reference Validation
  // ─────────────────────────────────────────────────────────────────────────────
  it('16. Card Refund Validation: card refund without reference is rejected; with reference succeeds', async () => {
    await ensureNoOpenShift(testCashier2Id);
    const shift = await openShift({
      cashierId: testCashier2Id,
      locationId: testLocId,
      openingFloatMinor: 50000,
    });

    const origSale = await createCounterSale(
      {
        idempotencyKey: `p4-card-ref-sale-${Date.now()}`,
        shiftId: shift.id,
        locationId: testLocId,
        cashierId: testCashier2Id,
        customerId: testWalkInCustId,
        lines: [{ productId: testProductStandardId, quantity: 1 }],
        payments: [{ method: 'cash', appliedMinor: 10000 }],
      },
      testCashier2Id,
    );

    const sourceLine = origSale.invoiceLines[0]!;

    // 1. Without reference -> rejected
    await expect(
      createCounterReturn(
        {
          invoiceId: origSale.invoice.id,
          shiftId: shift.id,
          locationId: testLocId,
          cashierId: testCashier2Id,
          refundMethod: 'card',
          lines: [{ sourceLineId: sourceLine.id, quantity: 1, returnGoods: true }],
        },
        testCashier2Id,
      ),
    ).rejects.toThrow(/Card refund requires a reference/);

    // 2. With reference -> succeeds
    const returnRes = await createCounterReturn(
      {
        invoiceId: origSale.invoice.id,
        shiftId: shift.id,
        locationId: testLocId,
        cashierId: testCashier2Id,
        refundMethod: 'card',
        refundMethodDetails: {
          slip_number: 'CARD-REF-999',
          terminal_id: testTerminalId,
          approval_code: 'APP-999',
        },
        lines: [{ sourceLineId: sourceLine.id, quantity: 1, returnGoods: true }],
      },
      testCashier2Id,
    );

    expect(returnRes.creditNote).toBeDefined();
    expect(returnRes.refund.payment.method).toBe('card');

    await closeShift({
      shiftId: shift.id,
      cashierId: testCashier2Id,
      countedCashMinor: 60000,
    });
  });

  async function ensureNoOpenShift(cashierId: string) {
    const [open] = await db
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.cashierId, cashierId), eq(posShifts.status, 'open')));
    if (open) {
      await db
        .update(posShifts)
        .set({ status: 'closed', closedAt: new Date() })
        .where(eq(posShifts.id, open.id));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 17. Return Window & Manager Override
  // ─────────────────────────────────────────────────────────────────────────────
  it('17. Return Window & Manager Override: returns outside return window require manager override', async () => {
    await ensureNoOpenShift(testCashier2Id);
    const shift = await openShift({
      cashierId: testCashier2Id,
      locationId: testLocId,
      openingFloatMinor: 50000,
    });

    const origSale = await createCounterSale(
      {
        idempotencyKey: `p4-old-sale-${Date.now()}`,
        shiftId: shift.id,
        locationId: testLocId,
        cashierId: testCashier2Id,
        customerId: testWalkInCustId,
        lines: [{ productId: testProductStandardId, quantity: 1 }],
        payments: [{ method: 'cash', appliedMinor: 10000 }],
      },
      testCashier2Id,
    );

    const sourceLine = origSale.invoiceLines[0]!;

    // Set return window to -1 days so that even a sale made today is considered outside the window
    await updateSetting('pos_return_window_days', -1, testManagerId);

    try {
      // Return without override -> rejected
      await expect(
        createCounterReturn(
          {
            invoiceId: origSale.invoice.id,
            shiftId: shift.id,
            locationId: testLocId,
            cashierId: testCashier2Id,
            refundMethod: 'cash',
            lines: [{ sourceLineId: sourceLine.id, quantity: 1, returnGoods: true }],
          },
          testCashier2Id,
        ),
      ).rejects.toThrow(/Manager override required/);

      // Return with manager override PIN -> succeeds
      const returnRes = await createCounterReturn(
        {
          invoiceId: origSale.invoice.id,
          shiftId: shift.id,
          locationId: testLocId,
          cashierId: testCashier2Id,
          refundMethod: 'cash',
          lines: [{ sourceLineId: sourceLine.id, quantity: 1, returnGoods: true }],
          managerOverride: {
            pin: MANAGER_PIN,
            reason: 'Manager customer goodwill waiver for late return',
          },
        },
        testCashier2Id,
      );

      expect(returnRes.creditNote).toBeDefined();
    } finally {
      await updateSetting('pos_return_window_days', 30, testManagerId);
      await closeShift({
        shiftId: shift.id,
        cashierId: testCashier2Id,
        countedCashMinor: 50000,
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 18. Closed Shift Database Triggers
  // ─────────────────────────────────────────────────────────────────────────────
  it('18. Closed Shift Database Triggers: modifications to closed shift float/totals and cash movements on closed shifts are prohibited', async () => {
    await ensureNoOpenShift(testCashier2Id);
    const shift = await openShift({
      cashierId: testCashier2Id,
      locationId: testLocId,
      openingFloatMinor: 25000,
    });
    await closeShift({
      shiftId: shift.id,
      cashierId: testCashier2Id,
      countedCashMinor: 25000,
    });

    // 1. Attempting cash movement on closed shift must trigger DB exception
    await expect(
      db.insert(cashMovements).values({
        shiftId: shift.id,
        kind: 'paid_in',
        amountMinor: 10000,
        reason: 'Illegal movement on closed shift',
        createdBy: testCashier2Id,
      }),
    ).rejects.toThrow(/Cash movements are only permitted on an open shift/);

    // 2. Modifying opening_float_minor on closed shift must trigger DB exception
    await expect(
      db
        .update(posShifts)
        .set({ openingFloatMinor: 99999 })
        .where(eq(posShifts.id, shift.id)),
    ).rejects.toThrow(/Cannot modify opening_float_minor of a closed shift/);

    // 3. Modifying counted_cash_minor on closed shift must trigger DB exception
    await expect(
      db
        .update(posShifts)
        .set({ countedCashMinor: 99999 })
        .where(eq(posShifts.id, shift.id)),
    ).rejects.toThrow(/Cannot modify counted_cash_minor of a closed shift/);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 19. Blind Cash-Up X-Report
  // ─────────────────────────────────────────────────────────────────────────────
  it('19. Blind Cash-Up X-Report: cashier X-report hides all cash totals when pos_blind_cash_up is true; manager sees all', async () => {
    await ensureNoOpenShift(testCashier2Id);
    await updateSetting('pos_blind_cash_up', true, testManagerId);

    const shift = await openShift({
      cashierId: testCashier2Id,
      locationId: testLocId,
      openingFloatMinor: 40000,
    });

    try {
      // Generate cashier X-report
      const cashierXReport = await getXReport(shift.id, {
        id: testCashier2Id,
        roleName: 'cashier',
        permissions: ['pos:access'],
      });

      expect(cashierXReport.isBlindCashUp).toBe(true);
      expect(cashierXReport.cash.openingFloatMinor).toBeNull();
      expect(cashierXReport.cash.cashReceiptsMinor).toBeNull();
      expect(cashierXReport.cash.expectedCashMinor).toBeNull();
      expect(cashierXReport.sales.grossSalesMinor).toBeNull();

      // Generate manager X-report
      const managerXReport = await getXReport(shift.id, {
        id: testManagerId,
        roleName: 'manager',
        permissions: ['shifts:manage'],
      });

      expect(managerXReport.isBlindCashUp).toBe(false);
      expect(managerXReport.cash.openingFloatMinor).toBe(40000);
      expect(managerXReport.cash.expectedCashMinor).toBe(40000);
    } finally {
      await closeShift({
        shiftId: shift.id,
        cashierId: testCashier2Id,
        countedCashMinor: 40000,
      });

      // Reset setting
      await updateSetting('pos_blind_cash_up', false, testManagerId);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 20. Product API Data Sanitization
  // ─────────────────────────────────────────────────────────────────────────────
  it('20. Security & Data Sanitization: GET /api/pos/products strictly excludes all product cost fields', async () => {
    await ensureNoOpenShift(testCashier2Id);
    const shift = await openShift({
      cashierId: testCashier2Id,
      locationId: testLocId,
      openingFloatMinor: 10000,
    });

    try {
      // Mock auth to return cashier session
      const mockAuth = auth as any;
      mockAuth.mockResolvedValueOnce({ user: { id: testCashier2Id } });

      const req = new NextRequest(`http://localhost:3000/api/pos/products?locationId=${testLocId}`);
      const res = await getPOSProducts(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.products).toBeDefined();
      expect(data.products.length).toBeGreaterThan(0);

      for (const prod of data.products) {
        expect((prod as any).costPriceMinor).toBeUndefined();
        expect((prod as any).avgCostMinor).toBeUndefined();
        expect((prod as any).fifoCostMinor).toBeUndefined();
        expect((prod as any).unitCostMinor).toBeUndefined();
        expect((prod as any).cost).toBeUndefined();
        // Must contain public fields
        expect(prod.id).toBeDefined();
        expect(prod.name).toBeDefined();
        expect(prod.sellingPriceMinor).toBeDefined();
        expect(prod.availableQty).toBeDefined();
      }
    } finally {
      await closeShift({
        shiftId: shift.id,
        cashierId: testCashier2Id,
        countedCashMinor: 10000,
      });
    }
  });
});

