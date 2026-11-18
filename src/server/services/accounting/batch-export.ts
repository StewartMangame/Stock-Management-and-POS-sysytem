/**
 * Accounting Batch CSV Export Service (Milestone 7).
 *
 * Requirements:
 *   1. CSV starts with UTF-8 BOM (\uFEFF) for Excel compatibility.
 *   2. Prominent DRAFT watermark: "DRAFT — Account codes are placeholders. Do not submit to MRA."
 *   3. Formula injection protection: all fields starting with '=', '+', '-', '@' are sanitized with leading single quote.
 *   4. Re-export requires explicit manager authorization and a non-empty reason.
 *   5. Double-entry balance check verification included in export summary.
 */

import { db } from '@/server/db';
import { journalBatches, journalLines, journalBatchExports, users } from '@/server/db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { formatMwk } from '@/lib/money';

/**
 * Escapes CSV values and prevents CSV formula injection.
 */
export function sanitizeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  let str = String(value);

  // Formula injection prevention: prefix dangerous trigger characters with a single quote
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // Escape double quotes
  str = str.replace(/"/g, '""');
  return `"${str}"`;
}

export interface ExportBatchResult {
  filename: string;
  csvContent: string;
  isDraft: boolean;
  totalDebitMinor: number;
  totalCreditMinor: number;
  lineCount: number;
  isBalanced: boolean;
}

/**
 * Generates the CSV export for a Journal Batch.
 * If batch was already exported, requires manager approval with reason.
 */
export async function exportJournalBatchToCsv(
  batchId: string,
  actorId: string,
  reExportApproval?: {
    approvedByManagerId: string;
    reason: string;
  },
): Promise<ExportBatchResult> {
  const [batch] = await db
    .select()
    .from(journalBatches)
    .where(eq(journalBatches.id, batchId));

  if (!batch) {
    throw new Error(`Journal batch ${batchId} not found.`);
  }

  // Re-export guard: if already exported in journal_batch_exports, manager approval with reason is mandatory
  const priorExports = await db
    .select()
    .from(journalBatchExports)
    .where(eq(journalBatchExports.batchId, batchId))
    .orderBy(desc(journalBatchExports.exportedAt));

  const isReExport = priorExports.length > 0;

  if (isReExport) {
    if (!reExportApproval?.approvedByManagerId || !reExportApproval.reason?.trim()) {
      throw new Error(
        'Re-export requires manager approval and a stated reason. This batch has already been exported.',
      );
    }

    // Verify manager exists
    const [manager] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, reExportApproval.approvedByManagerId));

    if (!manager) {
      throw new Error('Designated re-export approving manager does not exist.');
    }
  }

  // Fetch all lines for the batch in order
  const lines = await db
    .select()
    .from(journalLines)
    .where(eq(journalLines.batchId, batchId))
    .orderBy(asc(journalLines.entryDate), asc(journalLines.entryNumber));

  let totalDebitMinor = 0;
  let totalCreditMinor = 0;

  for (const l of lines) {
    totalDebitMinor += l.debitMinor;
    totalCreditMinor += l.creditMinor;
  }

  const isBalanced = totalDebitMinor === totalCreditMinor;
  if (!isBalanced) {
    throw new Error(`Double-entry balance check failed! Batch ${batch.batchNumber} is not balanced.`);
  }

  // Build CSV with UTF-8 BOM
  const BOM = '\uFEFF';
  const rows: string[] = [];

  // DRAFT Watermark & Metadata headers
  rows.push(sanitizeCsvField('*** DRAFT — ACCOUNT CODES ARE PLACEHOLDERS. DO NOT SUBMIT TO MRA. ***'));
  rows.push(
    [
      sanitizeCsvField(`Batch: ${batch.batchNumber}`),
      sanitizeCsvField(`Period: ${batch.periodStart.toISOString().split('T')[0]} to ${batch.periodEnd.toISOString().split('T')[0]}`),
      sanitizeCsvField(`Exported: ${new Date().toISOString()}`),
      sanitizeCsvField(`Status: ${isBalanced ? 'BALANCED' : 'UNBALANCED'}`),
    ].join(','),
  );
  rows.push(''); // Blank row separator

  // Table header
  rows.push(
    [
      sanitizeCsvField('Entry Date'),
      sanitizeCsvField('Entry Number'),
      sanitizeCsvField('Event Type'),
      sanitizeCsvField('Account Code'),
      sanitizeCsvField('Account Name'),
      sanitizeCsvField('Description'),
      sanitizeCsvField('Debit (MWK)'),
      sanitizeCsvField('Credit (MWK)'),
    ].join(','),
  );

  // Data rows
  for (const l of lines) {
    const debitMwk = (l.debitMinor / 100).toFixed(2);
    const creditMwk = (l.creditMinor / 100).toFixed(2);

    rows.push(
      [
        sanitizeCsvField(l.entryDate.toISOString().split('T')[0]),
        sanitizeCsvField(l.entryNumber),
        sanitizeCsvField(l.eventType),
        sanitizeCsvField(l.accountCode),
        sanitizeCsvField(l.accountName),
        sanitizeCsvField(l.description),
        sanitizeCsvField(debitMwk),
        sanitizeCsvField(creditMwk),
      ].join(','),
    );
  }

  // Summary footer row
  rows.push('');
  rows.push(
    [
      sanitizeCsvField('TOTALS'),
      sanitizeCsvField(''),
      sanitizeCsvField(''),
      sanitizeCsvField(''),
      sanitizeCsvField(''),
      sanitizeCsvField(`Balance Check: ${isBalanced ? 'OK (Debits equal Credits)' : 'MISMATCH'}`),
      sanitizeCsvField((totalDebitMinor / 100).toFixed(2)),
      sanitizeCsvField((totalCreditMinor / 100).toFixed(2)),
    ].join(','),
  );

  const csvContent = BOM + rows.join('\r\n');
  const filename = `${batch.batchNumber}-DRAFT.csv`;

  // Record export in append-only journal_batch_exports (journal_batches remains strictly append-only)
  await db.insert(journalBatchExports).values({
    batchId,
    exportType: isReExport ? 're_export' : 'initial',
    exportedAt: new Date(),
    exportedBy: actorId,
    reExportApprovedBy: isReExport ? reExportApproval!.approvedByManagerId : null,
    reExportApprovedAt: isReExport ? new Date() : null,
    reExportReason: isReExport ? reExportApproval!.reason.trim() : null,
  });

  return {
    filename,
    csvContent,
    isDraft: true,
    totalDebitMinor,
    totalCreditMinor,
    lineCount: lines.length,
    isBalanced,
  };
}
