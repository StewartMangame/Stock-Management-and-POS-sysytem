import type { db as DbType } from '@/server/db';
import { numberSequences, locations } from '@/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { formatDocNumber } from '@/lib/money';

export async function getNextDocNumber(
  tx: any,
  docType: string,
  locationId: string,
): Promise<string> {
  // Ensure row exists
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

  const num = seq!.nextNumber;
  const formatted = formatDocNumber(seq!.prefix, num, seq!.padding);

  // Increment
  await tx
    .update(numberSequences)
    .set({
      nextNumber: num + 1,
      updatedAt: new Date(),
    })
    .where(eq(numberSequences.id, seq!.id));

  return formatted;
}
