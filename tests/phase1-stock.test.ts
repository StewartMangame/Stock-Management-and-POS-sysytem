/**
 * Phase 1 Stock & Purchasing Integration & Invariant Tests.
 *
 * Verifies all Phase 1 requirements:
 *   1. Average cost across several receipts including landed cost
 *   2. Landed cost shares add up exactly (Largest Remainder Method)
 *   3. Ledger and balances always agree
 *   4. Rebuild script restores balances and avg_cost_minor exactly
 *   5. Two simultaneous issues of the last unit (only one succeeds)
 *   6. Duplicate serial rejected
 *   7. Permission checks per role (manager vs storekeeper vs cashier vs viewer)
 *   8. Average cost across two locations
 *   9. USD purchase order with exchange rate
 *  10. Count where a movement happens between count and reconcile
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, pool } from '@/server/db';
import {
  products,
  categories,
  unitsOfMeasure,
  locations,
  stockBalances,
  stockMovements,
  serialNumbers,
  suppliers,
  purchaseOrders,
  purchaseOrderItems,
  goodsReceipts,
  goodsReceiptItems,
  landedCosts,
  roles,
  users,
} from '@/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import {
  calcNewCompanyAverageCost,
  allocateLandedCostsLargestRemainder,
  convertSupplierToMwkMinor,
} from '@/lib/stock-math';
import {
  executeStockMovements,
  rebuildStockBalances,
  checkStockLedgerConsistency,
} from '@/server/services/stock/stock-engine';
import { createGoodsReceipt } from '@/server/services/purchasing/goods-receipts';
import { createStockAdjustment } from '@/server/services/stock/stock-adjustments';
import { createStockCount, reconcileStockCount } from '@/server/services/stock/stock-counts';
import { ROLE_PERMISSIONS, PERMISSIONS } from '@/lib/permissions';

describe('Phase 1 Stock & Purchasing Invariants', () => {
  let testLocAId: string;
  let testLocBId: string;
  let testUomId: string;
  let testCatId: string;
  let testSupplierId: string;

  beforeAll(async () => {
    // 1. Ensure test locations exist
    const [locA] = await db
      .insert(locations)
      .values({
        name: 'Test Outlet North',
        code: `TST-N-${Date.now()}`,
        type: 'outlet',
      })
      .returning();
    testLocAId = locA!.id;

    const [locB] = await db
      .insert(locations)
      .values({
        name: 'Test Warehouse South',
        code: `TST-S-${Date.now()}`,
        type: 'warehouse',
      })
      .returning();
    testLocBId = locB!.id;

    // 2. Ensure test UOM exists
    const [uom] = await db
      .insert(unitsOfMeasure)
      .values({
        name: 'Test Item UOM',
        code: `TUOM-${Date.now()}`,
        symbol: 'tst',
        allowDecimal: false,
      })
      .returning();
    testUomId = uom!.id;

    // 3. Ensure test Category exists
    const [cat] = await db
      .insert(categories)
      .values({
        name: 'Test Category',
        code: `TCAT-${Date.now()}`,
      })
      .returning();
    testCatId = cat!.id;

    // 4. Ensure test Supplier exists
    const [sup] = await db
      .insert(suppliers)
      .values({
        name: 'Test Supplier International',
        code: `TSUP-${Date.now()}`,
        defaultCurrency: 'USD',
      })
      .returning();
    testSupplierId = sup!.id;
  });

  // ── 1. Average Cost across several receipts including landed cost ─────────────

  describe('Average Cost & Landed Cost Arithmetic', () => {
    it('calculates average cost correctly across multiple receipts with landed cost', () => {
      // Step 1: Initial state (0 on hand, 0 cost)
      // Receipt 1: 10 units @ 10,000 tambala, landed cost 2,000 tambala per unit -> 12,000 landed unit cost
      let avg = calcNewCompanyAverageCost(0, 0, 10, 12000);
      expect(avg).toBe(12000);

      // Receipt 2: 10 units @ 14,000 tambala, landed cost 4,000 per unit -> 18,000 landed unit cost
      // (10 * 12000 + 10 * 18000) / 20 = 300,000 / 20 = 15,000
      avg = calcNewCompanyAverageCost(10, avg, 10, 18000);
      expect(avg).toBe(15000);

      // Receipt 3: 20 units @ 9,000 landed unit cost
      // (20 * 15000 + 20 * 9000) / 40 = 480,000 / 40 = 12,000
      avg = calcNewCompanyAverageCost(20, avg, 20, 9000);
      expect(avg).toBe(12000);
    });

    it('rounds half-up accurately according to commercial rounding', () => {
      // 1 unit @ 3 tambala + 1 unit @ 4 tambala = 7 / 2 = 3.5 -> 4
      const avg = calcNewCompanyAverageCost(1, 3, 1, 4);
      expect(avg).toBe(4);
    });
  });

  // ── 2. Largest Remainder Landed Cost Allocation ───────────────────────────────

  describe('Largest Remainder Method (Hare-Niemeyer)', () => {
    it('shares landed costs so that line shares add up exactly to total landed cost', () => {
      // 3 lines with irregular values: 10,000 (23.8%), 12,000 (28.6%), 20,000 (47.6%)
      // Total landed cost: 100 tambala
      const lineValues = [10000, 12000, 20000];
      const totalLanded = 100;

      const shares = allocateLandedCostsLargestRemainder(lineValues, totalLanded);
      expect(shares.length).toBe(3);

      const sum = shares.reduce((a, b) => a + b, 0);
      expect(sum).toBe(totalLanded);

      // Quotas:
      // Line 0: 10000/42000 * 100 = 23.8095 -> floor 23, rem 0.8095
      // Line 1: 12000/42000 * 100 = 28.5714 -> floor 28, rem 0.5714
      // Line 2: 20000/42000 * 100 = 47.6190 -> floor 47, rem 0.6190
      // Sum of floors: 23 + 28 + 47 = 98. Remainder to distribute = 2.
      // Top 2 remainders are Line 0 (0.8095) and Line 2 (0.6190).
      // Line 0 gets 23 + 1 = 24.
      // Line 1 gets 28.
      // Line 2 gets 47 + 1 = 48.
      expect(shares[0]).toBe(24);
      expect(shares[1]).toBe(28);
      expect(shares[2]).toBe(48);
    });

    it('handles zero line values by equal distribution with remainder', () => {
      const shares = allocateLandedCostsLargestRemainder([0, 0, 0], 10);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(10);
      // 10 / 3 = 3 with remainder 1 -> [4, 3, 3]
      expect(shares).toEqual([4, 3, 3]);
    });
  });

  // ── 3. Multi-Location Company-Wide Average Cost ───────────────────────────────

  describe('Company-Wide Average Cost Across Two Locations', () => {
    it('updates company-wide average cost on receipt at any location', async () => {
      const [prod] = await db
        .insert(products)
        .values({
          name: 'Multi-Loc Widget',
          sku: `SKU-MLW-${Date.now()}`,
          uomId: testUomId,
          categoryId: testCatId,
          sellingPriceMinor: 50000,
        })
        .returning();

      // Location A receives 10 units @ 10,000 MWK (1,000,000 tambala)
      await db.transaction(async (tx) => {
        await executeStockMovements(tx, [
          {
            productId: prod!.id,
            locationId: testLocAId,
            quantity: '10',
            unitCostMinor: 1000000,
            movementType: 'purchase_receipt',
            referenceType: 'goods_receipt',
          },
        ]);
      });

      let [freshProd] = await db.select().from(products).where(eq(products.id, prod!.id));
      expect(Number(freshProd!.avgCostMinor)).toBe(1000000);

      // Location B receives 10 units @ 20,000 MWK (2,000,000 tambala)
      // Expected new company avg: (10 * 1000000 + 10 * 2000000) / 20 = 1,500,000
      await db.transaction(async (tx) => {
        await executeStockMovements(tx, [
          {
            productId: prod!.id,
            locationId: testLocBId,
            quantity: '10',
            unitCostMinor: 2000000,
            movementType: 'purchase_receipt',
            referenceType: 'goods_receipt',
          },
        ]);
      });

      [freshProd] = await db.select().from(products).where(eq(products.id, prod!.id));
      expect(Number(freshProd!.avgCostMinor)).toBe(1500000);

      // Verify location balances are tracked separately
      const balA = await db.query.stockBalances.findFirst({
        where: and(eq(stockBalances.productId, prod!.id), eq(stockBalances.locationId, testLocAId)),
      });
      const balB = await db.query.stockBalances.findFirst({
        where: and(eq(stockBalances.productId, prod!.id), eq(stockBalances.locationId, testLocBId)),
      });

      expect(parseFloat(balA!.onHand)).toBe(10);
      expect(parseFloat(balB!.onHand)).toBe(10);
    });
  });

  // ── 4. USD Purchase Order with Exchange Rate ─────────────────────────────────

  describe('USD Purchase Order with Currency Conversion', () => {
    it('converts supplier currency to MWK minor accurately at the exchange rate', () => {
      // 50.25 USD at 1750.50 MWK/USD
      // MWK amount = 50.25 * 1750.50 = 87962.625 MWK = 8796262.5 tambala -> 8796263
      const mwkMinor = convertSupplierToMwkMinor('50.25', '1750.500000');
      expect(mwkMinor).toBe(8796263);
    });
  });

  // ── 5. Serial Number Rules & Invariants ──────────────────────────────────────

  describe('Serial Number Invariants', () => {
    it('requires exactly 1 serial per unit received and rejects duplicates', async () => {
      const [prod] = await db
        .insert(products)
        .values({
          name: 'Tracked Drone',
          sku: `SKU-DRN-${Date.now()}`,
          uomId: testUomId,
          categoryId: testCatId,
          sellingPriceMinor: 100000,
          serialTracking: true,
          warrantyMonths: 12,
        })
        .returning();

      // Receipt of 2 units with only 1 serial must fail
      await expect(
        db.transaction(async (tx) => {
          await executeStockMovements(tx, [
            {
              productId: prod!.id,
              locationId: testLocAId,
              quantity: '2',
              unitCostMinor: 50000,
              movementType: 'purchase_receipt',
              referenceType: 'goods_receipt',
              serialNumbers: ['SN-001'],
            },
          ]);
        }),
      ).rejects.toThrow(/Serial count mismatch/);

      // Receipt of 2 units with valid serials succeeds
      await db.transaction(async (tx) => {
        await executeStockMovements(tx, [
          {
            productId: prod!.id,
            locationId: testLocAId,
            quantity: '2',
            unitCostMinor: 50000,
            movementType: 'purchase_receipt',
            referenceType: 'goods_receipt',
            serialNumbers: ['SN-100', 'SN-200'],
          },
        ]);
      });

      // Attempting to receive SN-100 again (case-insensitive duplicate) must fail
      await expect(
        db.transaction(async (tx) => {
          await executeStockMovements(tx, [
            {
              productId: prod!.id,
              locationId: testLocBId,
              quantity: '1',
              unitCostMinor: 50000,
              movementType: 'purchase_receipt',
              referenceType: 'goods_receipt',
              serialNumbers: ['sn-100'],
            },
          ]);
        }),
      ).rejects.toThrow(/Duplicate serial number/);
    });
  });

  // ── 6. Immutable Ledger Trigger ──────────────────────────────────────────────

  describe('Immutable Ledger Trigger (Rule 5)', () => {
    it('prohibits UPDATE and DELETE on stock_movements table via database trigger', async () => {
      const [prod] = await db
        .insert(products)
        .values({
          name: 'Trigger Test Item',
          sku: `SKU-TRG-${Date.now()}`,
          uomId: testUomId,
        })
        .returning();

      const [movement] = await db
        .insert(stockMovements)
        .values({
          productId: prod!.id,
          locationId: testLocAId,
          movementType: 'opening',
          quantity: '5',
          unitCostMinor: 1000,
          totalCostMinor: 5000,
          referenceType: 'opening_stock',
        })
        .returning();

      // Direct SQL UPDATE must throw trigger exception
      await expect(
        db.execute(sql`UPDATE stock_movements SET quantity = 10 WHERE id = ${movement!.id}`),
      ).rejects.toThrow(/append-only ledger: UPDATE and DELETE are prohibited/);

      // Direct SQL DELETE must throw trigger exception
      await expect(
        db.execute(sql`DELETE FROM stock_movements WHERE id = ${movement!.id}`),
      ).rejects.toThrow(/append-only ledger: UPDATE and DELETE are prohibited/);
    });
  });

  // ── 7. Rebuild Script Reproduces Balances and Avg Cost Exactly ────────────────

  describe('Rebuild Script & Consistency Check (Rule 6)', () => {
    it('rebuilds stock balances and company average cost perfectly from the ledger', async () => {
      const [prod] = await db
        .insert(products)
        .values({
          name: 'Rebuild Test Item',
          sku: `SKU-RBD-${Date.now()}`,
          uomId: testUomId,
        })
        .returning();

      // Execute 2 movements: 5 units @ 10,000, then 5 units @ 20,000
      await db.transaction(async (tx) => {
        await executeStockMovements(tx, [
          {
            productId: prod!.id,
            locationId: testLocAId,
            quantity: '5',
            unitCostMinor: 10000,
            movementType: 'purchase_receipt',
            referenceType: 'goods_receipt',
          },
        ]);
        await executeStockMovements(tx, [
          {
            productId: prod!.id,
            locationId: testLocAId,
            quantity: '5',
            unitCostMinor: 20000,
            movementType: 'purchase_receipt',
            referenceType: 'goods_receipt',
          },
        ]);
      });

      // Verify baseline consistency
      const checkBefore = await checkStockLedgerConsistency(db);
      expect(checkBefore.isConsistent).toBe(true);

      // Intentionally corrupt the balance table to simulate discrepancy
      await db
        .update(stockBalances)
        .set({ onHand: '999.000' })
        .where(
          and(
            eq(stockBalances.productId, prod!.id),
            eq(stockBalances.locationId, testLocAId),
          ),
        );

      // Check must catch this corruption
      const checkCorrupt = await checkStockLedgerConsistency(db);
      expect(checkCorrupt.isConsistent).toBe(false);
      expect(checkCorrupt.discrepancies.some((d) => d.productId === prod!.id)).toBe(true);

      // Run rebuild routine
      await db.transaction(async (tx) => {
        await rebuildStockBalances(tx);
      });

      // Verify restored consistency
      const checkAfter = await checkStockLedgerConsistency(db);
      expect(checkAfter.isConsistent).toBe(true);

      // Verify on-hand restored to 10
      const bal = await db.query.stockBalances.findFirst({
        where: and(eq(stockBalances.productId, prod!.id), eq(stockBalances.locationId, testLocAId)),
      });
      expect(parseFloat(bal!.onHand)).toBe(10);

      // Verify average cost restored to 15,000
      const [restoredProd] = await db.select().from(products).where(eq(products.id, prod!.id));
      expect(Number(restoredProd!.avgCostMinor)).toBe(15000);
    });
  });

  // ── 8. Concurrency: Two Simultaneous Issues of the Last Unit ─────────────────

  describe('Concurrency & Deadlock Prevention (Rule 4)', () => {
    it('allows only one transaction to issue the last unit while the other fails with insufficient stock', async () => {
      const [prod] = await db
        .insert(products)
        .values({
          name: 'Race Condition Item',
          sku: `SKU-RCE-${Date.now()}`,
          uomId: testUomId,
        })
        .returning();

      // Seed exactly 1 unit
      await db.transaction(async (tx) => {
        await executeStockMovements(tx, [
          {
            productId: prod!.id,
            locationId: testLocAId,
            quantity: '1',
            unitCostMinor: 10000,
            movementType: 'opening',
            referenceType: 'opening_stock',
          },
        ]);
      });

      // Launch 2 simultaneous outward adjustments of 1 unit
      const tx1 = db.transaction(async (tx) => {
        await executeStockMovements(tx, [
          {
            productId: prod!.id,
            locationId: testLocAId,
            quantity: '-1',
            movementType: 'adjustment',
            referenceType: 'stock_adjustment',
          },
        ]);
        return 'success';
      });

      const tx2 = db.transaction(async (tx) => {
        await executeStockMovements(tx, [
          {
            productId: prod!.id,
            locationId: testLocAId,
            quantity: '-1',
            movementType: 'adjustment',
            referenceType: 'stock_adjustment',
          },
        ]);
        return 'success';
      });

      const results = await Promise.allSettled([tx1, tx2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly 1 must succeed, exactly 1 must fail with insufficient stock
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('Insufficient stock');
    });
  });

  // ── 9. Count with Intervening Movement Warning ───────────────────────────────

  describe('Stock Count Reconciliation Invariants (Rule 7)', () => {
    it('warns when a movement happens between count start and reconciliation', async () => {
      const [prod] = await db
        .insert(products)
        .values({
          name: 'Intervening Movement Item',
          sku: `SKU-INT-${Date.now()}`,
          uomId: testUomId,
        })
        .returning();

      // Start count
      const count = await createStockCount({
        locationId: testLocAId,
        items: [{ productId: prod!.id, countedQty: '5' }],
      });

      // Simulate a receipt movement that happens AFTER count started
      await db.transaction(async (tx) => {
        await executeStockMovements(tx, [
          {
            productId: prod!.id,
            locationId: testLocAId,
            quantity: '2',
            unitCostMinor: 5000,
            movementType: 'purchase_receipt',
            referenceType: 'goods_receipt',
            occurredAt: new Date(Date.now() + 1000), // strictly after countedAt
          },
        ]);
      });

      // Reconcile
      const recResult = await reconcileStockCount(count.id, [
        { productId: prod!.id, countedQty: '5' },
      ]);

      expect(recResult.hasInterveningMovements).toBe(true);
      expect(recResult.warningMessage).toContain('Stock movements were recorded after this count began');
    });
  });

  // ── 10. Role Permission Matrix ───────────────────────────────────────────────

  describe('Permission Matrix Enforcement', () => {
    it('verifies that managers have stock:adjust and stock:count while cashiers/viewers do not', () => {
      const managerPerms = ROLE_PERMISSIONS['manager'] || [];
      const storekeeperPerms = ROLE_PERMISSIONS['storekeeper'] || [];
      const cashierPerms = ROLE_PERMISSIONS['cashier'] || [];
      const viewerPerms = ROLE_PERMISSIONS['viewer'] || [];

      // Manager has adjustment and count permissions
      expect(managerPerms).toContain(PERMISSIONS.STOCK_ADJUST);
      expect(managerPerms).toContain(PERMISSIONS.STOCK_COUNT);

      // Storekeeper has adjustment and count permissions
      expect(storekeeperPerms).toContain(PERMISSIONS.STOCK_ADJUST);
      expect(storekeeperPerms).toContain(PERMISSIONS.STOCK_COUNT);

      // Cashier and viewer do NOT have adjust permissions
      expect(cashierPerms).not.toContain(PERMISSIONS.STOCK_ADJUST);
      expect(viewerPerms).not.toContain(PERMISSIONS.STOCK_ADJUST);
    });
  });
});
