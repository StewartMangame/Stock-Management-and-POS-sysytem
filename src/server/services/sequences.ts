import { numberSequences, locations } from '@/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { formatDocNumber } from '@/lib/money';

/**
 * Gets the next sequential document number within a transaction.
 *
 * Requirements:
 * - Strictly gap-free: Locks the number_sequences row (FOR UPDATE) within the
 *   SAME transaction as the document insert.
 * - If the transaction rolls back, the sequence row rollback returns the number.
 * - Does NOT skip existing numbers; any duplicate raises a database unique constraint error.
 */
export async function getNextDocNumber(
  tx: any,
  docType: string,
  locationId: string,
): Promise<string> {
  // 1. Ensure row exists and lock it with FOR UPDATE
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
      payment: 'PAY',
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

  // Increment sequence by 1 within this transaction
  await tx
    .update(numberSequences)
    .set({
      nextNumber: num + 1,
      updatedAt: new Date(),
    })
    .where(eq(numberSequences.id, seq!.id));

  return formatted;
}
