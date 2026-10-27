import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/server/db';
import { locations, suppliers, purchaseOrders, numberSequences } from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getNextDocNumber } from '@/server/services/sequences';

describe('Document Number Sequencing & Collision Prevention', () => {
  let testLocId: string;
  let testSupplierId: string;

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

    const [supp] = await db
      .insert(suppliers)
      .values({
        name: 'Seq Test Supplier',
        code: `SS-${Date.now().toString().slice(-4)}`,
      })
      .returning();
    testSupplierId = supp!.id;
  });

  it('skips existing document numbers to avoid unique constraint violations', async () => {
    // 1. Manually insert a PO with sequence number 1 before the sequence is even initialized
    const [loc] = await db.select({ code: locations.code }).from(locations).where(eq(locations.id, testLocId));
    const expectedFirstNum = `${loc!.code}-PO-0001`;

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

    // 2. Now call getNextDocNumber - it should detect PO-0001 is taken and automatically return PO-0002
    const docNum = await db.transaction(async (tx) => {
      return await getNextDocNumber(tx, 'purchase_order', testLocId);
    });

    const expectedSecondNum = `${loc!.code}-PO-0002`;
    expect(docNum).toBe(expectedSecondNum);

    // 3. Insert using the generated number - must succeed without unique constraint error
    await db.insert(purchaseOrders).values({
      poNumber: docNum,
      supplierId: testSupplierId,
      locationId: testLocId,
      status: 'draft',
      orderDate: new Date().toISOString().split('T')[0]!,
      currency: 'MWK',
      exchangeRate: '1',
      totalMinor: 200000,
      totalSupplierCurrency: '2000',
    });

    // 4. Next call should return PO-0003
    const nextDocNum = await db.transaction(async (tx) => {
      return await getNextDocNumber(tx, 'purchase_order', testLocId);
    });
    expect(nextDocNum).toBe(`${loc!.code}-PO-0003`);
  });
});
