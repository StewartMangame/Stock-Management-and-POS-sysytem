import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/server/db';
import { locations, suppliers, purchaseOrders, numberSequences } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { getNextDocNumber } from '@/server/services/sequences';

describe('Document Number Sequencing & Rollback Guarantees', () => {
  let testLocId: string;
  let testSupplierId: string;
  let locCode: string;

  beforeAll(async () => {
    const [loc] = await db
      .insert(locations)
      .values({
        name: 'Seq Test Outlet',
        code: `SQ-${Date.now().toString().slice(-4)}`,
        type: 'outlet',
      })
      .returning();
    testLocId = loc!.id;
    locCode = loc!.code;

    const [supp] = await db
      .insert(suppliers)
      .values({
        name: 'Seq Test Supplier',
        code: `SS-${Date.now().toString().slice(-4)}`,
      })
      .returning();
    testSupplierId = supp!.id;
  });

  it('generates strictly sequential numbers and duplicate insert raises error', async () => {
    // 1. Manually insert a PO with sequence number 1
    const expectedFirstNum = `${locCode}-PO-0001`;

    await db.insert(purchaseOrders).values({
      poNumber: expectedFirstNum,
      supplierId: testSupplierId,
      locationId: testLocId,
      status: 'draft',
      orderDate: new Date().toISOString().split('T')[0]!,
      currency: 'MWK',
      exchangeRate: '1',
      totalMinor: 100000,
      totalSupplierCurrency: '1000',
    });

    // 2. getNextDocNumber without skipping will yield PO-0001 from sequence table
    const docNum = await db.transaction(async (tx) => {
      return await getNextDocNumber(tx, 'purchase_order', testLocId);
    });
    expect(docNum).toBe(expectedFirstNum);

    // 3. Inserting the duplicate number MUST raise a database unique constraint error
    await expect(
      db.insert(purchaseOrders).values({
        poNumber: docNum,
        supplierId: testSupplierId,
        locationId: testLocId,
        status: 'draft',
        orderDate: new Date().toISOString().split('T')[0]!,
        currency: 'MWK',
        exchangeRate: '1',
        totalMinor: 200000,
        totalSupplierCurrency: '2000',
      })
    ).rejects.toThrow();
  });

  it('a rolled-back transaction does not burn a number', async () => {
    // We create a fresh location for isolated sequence testing
    const [loc] = await db
      .insert(locations)
      .values({
        name: 'Rollback Seq Outlet',
        code: `RB-${Date.now().toString().slice(-4)}`,
        type: 'outlet',
      })
      .returning();

    let rolledBackNumber = '';

    // Transaction that increments sequence and then fails/rolls back
    await expect(
      db.transaction(async (tx) => {
        rolledBackNumber = await getNextDocNumber(tx, 'invoice', loc!.id);
        expect(rolledBackNumber).toBe(`${loc!.code}-INV-0001`);
        throw new Error('Simulated failure during invoice creation');
      })
    ).rejects.toThrow('Simulated failure during invoice creation');

    // Next transaction attempting invoice creation receives the EXACT SAME number
    const retryNumber = await db.transaction(async (tx) => {
      return await getNextDocNumber(tx, 'invoice', loc!.id);
    });

    expect(retryNumber).toBe(rolledBackNumber);
    expect(retryNumber).toBe(`${loc!.code}-INV-0001`);
  });
});
