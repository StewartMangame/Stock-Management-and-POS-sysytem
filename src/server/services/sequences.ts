import {
  numberSequences,
  locations,
  purchaseOrders,
  goodsReceipts,
  stockAdjustments,
  stockCounts,
} from '@/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { formatDocNumber } from '@/lib/money';

async function isDocNumberTaken(tx: any, docType: string, formatted: string): Promise<boolean> {
  if (docType === 'purchase_order') {
    const existing = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.poNumber, formatted))
      .limit(1);
    return existing.length > 0;
  }
  if (docType === 'goods_receipt') {
    const existing = await tx
      .select({ id: goodsReceipts.id })
      .from(goodsReceipts)
      .where(eq(goodsReceipts.grnNumber, formatted))
      .limit(1);
    return existing.length > 0;
  }
  if (docType === 'stock_adjustment') {
    const existing = await tx
      .select({ id: stockAdjustments.id })
      .from(stockAdjustments)
      .where(eq(stockAdjustments.adjNumber, formatted))
      .limit(1);
    return existing.length > 0;
  }
  if (docType === 'stock_count') {
    const existing = await tx
      .select({ id: stockCounts.id })
      .from(stockCounts)
      .where(eq(stockCounts.countNumber, formatted))
      .limit(1);
    return existing.length > 0;
  }
  return false;
}

export async function getNextDocNumber(
  tx: any,
  docType: string,
  locationId: string,
): Promise<string> {
  // Ensure row exists and lock it
  let [seq] = await tx
    .select()
    .from(numberSequences)
    .where(and(eq(numberSequences.docType, docType), eq(numberSequences.locationId, locationId)))
    .for('update');

  if (!seq) {
    // Lookup location code to build default prefix
    const [loc] = await tx
      .select({ code: locations.code })
      .from(locations)
      .where(eq(locations.id, locationId));

    const locCode = loc?.code ?? 'MAIN';
    const typePrefixMap: Record<string, string> = {
      purchase_order: 'PO',
      goods_receipt: 'GRN',
      stock_adjustment: 'ADJ',
      stock_count: 'CNT',
      invoice: 'INV',
      quotation: 'QT',
      delivery_note: 'DN',
      credit_note: 'CN',
    };
    const prefix = `${locCode}-${typePrefixMap[docType] || docType.toUpperCase()}`;

    await tx
      .insert(numberSequences)
      .values({
        docType,
        locationId,
        prefix,
        nextNumber: 1,
        padding: 4,
      })
      .onConflictDoNothing();

    [seq] = await tx
      .select()
      .from(numberSequences)
      .where(and(eq(numberSequences.docType, docType), eq(numberSequences.locationId, locationId)))
      .for('update');
  }

  let num = seq!.nextNumber;
  let formatted = formatDocNumber(seq!.prefix, num, seq!.padding);

  // Skip any number that already exists in the table (e.g. from seeds or manual inserts)
  while (await isDocNumberTaken(tx, docType, formatted)) {
    num++;
    formatted = formatDocNumber(seq!.prefix, num, seq!.padding);
  }

  // Increment sequence to num + 1
  await tx
    .update(numberSequences)
    .set({
      nextNumber: num + 1,
      updatedAt: new Date(),
    })
    .where(eq(numberSequences.id, seq!.id));

  return formatted;
}
