/**
 * Bank Statement & Settlement Reconciliation Service.
 * Supports configurable mapping profiles, duplicate file detection, auto-matching, and group matching.
 */

import crypto from 'node:crypto';
import { db } from '@/server/db';
import {
  statementImports,
  statementLines,
  reconciliationMatches,
  statementMappingProfiles,
  payments,
} from '@/server/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { writeAuditLog } from '@/server/services/audit';
import { getNow } from '@/lib/timezone';

export interface ColumnMapping {
  dateColumn: string;
  referenceColumn: string;
  descriptionColumn?: string;
  amountColumn?: string;
  creditColumn?: string;
  debitColumn?: string;
  feeColumn?: string;
}

export interface ParseCsvOptions {
  filename: string;
  profileId?: string;
  userId?: string;
}

/**
 * Parses simple CSV content into headers and string rows.
 */
function parseCsvRows(csvContent: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = lines[0]!.split(',').map((h) => h.replace(/^["']|["']$/g, '').trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rawCols = lines[i]!.split(',');
    const rowObj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rowObj[h] = (rawCols[idx] || '').replace(/^["']|["']$/g, '').trim();
    });
    rows.push(rowObj);
  }

  return { headers, rows };
}

/**
 * Normalizes date string into YYYY-MM-DD.
 */
function parseDateString(dateStr: string, format = 'YYYY-MM-DD'): string {
  const parts = dateStr.split(/[\/\-\.]/);
  if (parts.length < 3) return new Date().toISOString().split('T')[0]!;

  if (format === 'DD/MM/YYYY') {
    return `${parts[2]}-${parts[1]!.padStart(2, '0')}-${parts[0]!.padStart(2, '0')}`;
  }
  if (format === 'MM/DD/YYYY') {
    return `${parts[2]}-${parts[0]!.padStart(2, '0')}-${parts[1]!.padStart(2, '0')}`;
  }
  // YYYY-MM-DD
  return `${parts[0]}-${parts[1]!.padStart(2, '0')}-${parts[2]!.padStart(2, '0')}`;
}

/**
 * Imports a Bank Statement or Settlement CSV.
 */
export async function importStatementCsv(
  csvContent: string,
  options: ParseCsvOptions,
) {
  const fileHash = crypto.createHash('sha256').update(csvContent).digest('hex');

  // 1. Check duplicate file
  const [existingImport] = await db
    .select()
    .from(statementImports)
    .where(eq(statementImports.fileHash, fileHash));

  if (existingImport) {
    throw new Error(`This statement file has already been imported on ${existingImport.importedAt.toISOString()}`);
  }

  // 2. Fetch profile if provided, or default
  let profile: typeof statementMappingProfiles.$inferSelect | undefined;
  if (options.profileId) {
    const [p] = await db
      .select()
      .from(statementMappingProfiles)
      .where(eq(statementMappingProfiles.id, options.profileId));
    profile = p;
  }

  const { rows } = parseCsvRows(csvContent);
  if (rows.length === 0) {
    throw new Error('CSV file contains no data rows.');
  }

  const mapping = (profile?.columnMapping as ColumnMapping) || {
    dateColumn: 'Date',
    referenceColumn: 'Reference',
    descriptionColumn: 'Description',
    amountColumn: 'Amount',
    creditColumn: 'Credit',
    feeColumn: 'Fee',
  };

  const dateFormat = profile?.dateFormat || 'YYYY-MM-DD';

  let totalAmountMinor = 0;
  const parsedLines: Array<{
    lineNumber: number;
    transactionDate: string;
    reference: string;
    description: string;
    amountMinor: number;
    feeMinor: number;
    rawData: any;
  }> = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx]!;
    const dateRaw = r[mapping.dateColumn] || '';
    const dateStr = parseDateString(dateRaw, dateFormat);
    const ref = r[mapping.referenceColumn] || '';
    const desc = (mapping.descriptionColumn ? r[mapping.descriptionColumn] : '') || '';

    let amountFloat = 0;
    if (mapping.creditColumn && r[mapping.creditColumn]) {
      amountFloat = parseFloat(r[mapping.creditColumn]!.replace(/[^0-9.-]/g, '')) || 0;
    } else if (mapping.amountColumn && r[mapping.amountColumn]) {
      amountFloat = parseFloat(r[mapping.amountColumn]!.replace(/[^0-9.-]/g, '')) || 0;
    }

    const feeFloat = mapping.feeColumn && r[mapping.feeColumn]
      ? parseFloat(r[mapping.feeColumn]!.replace(/[^0-9.-]/g, '')) || 0
      : 0;

    const amtMinor = Math.round(amountFloat * 100);
    const fMinor = Math.round(feeFloat * 100);

    totalAmountMinor += amtMinor;
    parsedLines.push({
      lineNumber: idx + 1,
      transactionDate: dateStr,
      reference: ref,
      description: desc,
      amountMinor: amtMinor,
      feeMinor: fMinor,
      rawData: r,
    });
  }

  // 3. Insert import record and lines in a single transaction
  return await db.transaction(async (tx) => {
    const [importDoc] = await tx
      .insert(statementImports)
      .values({
        fileHash,
        filename: options.filename,
        rowCount: parsedLines.length,
        totalAmountMinor,
        profileId: options.profileId,
        importedBy: options.userId,
      })
      .returning();

    const insertedLines: (typeof statementLines.$inferSelect)[] = [];
    for (const line of parsedLines) {
      const [l] = await tx
        .insert(statementLines)
        .values({
          importId: importDoc!.id,
          lineNumber: line.lineNumber,
          transactionDate: line.transactionDate,
          reference: line.reference,
          description: line.description,
          amountMinor: line.amountMinor,
          feeMinor: line.feeMinor,
          rawData: line.rawData,
          matchStatus: 'unmatched',
        })
        .returning();
      insertedLines.push(l!);
    }

    // 4. Run automatic matching against unreconciled payments
    let autoMatchedCount = 0;
    for (const stmtLine of insertedLines) {
      if (stmtLine.amountMinor <= 0) continue;

      // Rule A: Match by exact reference (providerReference or paymentNumber)
      if (stmtLine.reference) {
        const [candidate] = await tx
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.status, 'confirmed'),
              eq(payments.reconciliationStatus, 'unreconciled'),
              eq(payments.amountMinor, stmtLine.amountMinor),
              sql`(${payments.providerReference} = ${stmtLine.reference} OR ${payments.paymentNumber} = ${stmtLine.reference})`,
            ),
          );

        if (candidate) {
          // Check if candidate already has a match
          const [alreadyMatched] = await tx
            .select()
            .from(reconciliationMatches)
            .where(eq(reconciliationMatches.paymentId, candidate.id));

          if (!alreadyMatched) {
            await tx.insert(reconciliationMatches).values({
              statementLineId: stmtLine.id,
              paymentId: candidate.id,
              matchedAmountMinor: candidate.amountMinor,
              matchedBy: options.userId,
              notes: 'Auto-matched on exact reference and amount',
            });

            await tx
              .update(statementLines)
              .set({ matchStatus: 'matched' })
              .where(eq(statementLines.id, stmtLine.id));

            await tx
              .update(payments)
              .set({
                reconciliationStatus: 'reconciled',
                reconciledAt: getNow(),
                reconciledBy: options.userId,
                reconciliationNote: `Reconciled with statement import ${importDoc!.filename}`,
                updatedAt: getNow(),
              })
              .where(eq(payments.id, candidate.id));

            autoMatchedCount++;
          }
        }
      }
    }

    return {
      importDoc: importDoc!,
      rowCount: insertedLines.length,
      autoMatchedCount,
    };
  });
}

/**
 * Manually reconciles one statement line with one or more payments (1-to-many group match).
 */
export async function matchStatementLine(
  statementLineId: string,
  paymentIds: string[],
  userId?: string,
  notes?: string,
) {
  if (paymentIds.length === 0) {
    throw new Error('At least one payment must be selected for matching.');
  }

  return await db.transaction(async (tx) => {
    const [line] = await tx
      .select()
      .from(statementLines)
      .where(eq(statementLines.id, statementLineId))
      .for('update');

    if (!line) throw new Error('Statement line not found.');
    if (line.matchStatus === 'matched') {
      throw new Error('This statement line is already fully matched.');
    }

    const candidatePayments = await tx
      .select()
      .from(payments)
      .where(inArray(payments.id, paymentIds))
      .for('update');

    if (candidatePayments.length !== paymentIds.length) {
      throw new Error('One or more selected payments could not be found.');
    }

    // Verify each payment is confirmed and not yet matched
    for (const p of candidatePayments) {
      if (p.status !== 'confirmed') {
        throw new Error(`Payment '${p.paymentNumber}' cannot be reconciled: status is '${p.status}'.`);
      }
      const [existingMatch] = await tx
        .select()
        .from(reconciliationMatches)
        .where(eq(reconciliationMatches.paymentId, p.id));

      if (existingMatch) {
        throw new Error(`Payment '${p.paymentNumber}' has already been matched to another statement line.`);
      }
    }

    // Sum of payment amounts must equal statement line amount
    const totalPaymentsMinor = candidatePayments.reduce((sum, p) => sum + p.amountMinor, 0);
    if (totalPaymentsMinor !== line.amountMinor) {
      throw new Error(
        `Group match amount mismatch: sum of payments (${(totalPaymentsMinor / 100).toLocaleString()} MWK) does not equal statement line amount (${(line.amountMinor / 100).toLocaleString()} MWK).`,
      );
    }

    // Insert reconciliation matches
    for (const p of candidatePayments) {
      await tx.insert(reconciliationMatches).values({
        statementLineId: line.id,
        paymentId: p.id,
        matchedAmountMinor: p.amountMinor,
        matchedBy: userId,
        notes: notes || 'Manual match',
      });

      await tx
        .update(payments)
        .set({
          reconciliationStatus: 'reconciled',
          reconciledAt: getNow(),
          reconciledBy: userId,
          reconciliationNote: notes || 'Manually reconciled',
          updatedAt: getNow(),
        })
        .where(eq(payments.id, p.id));
    }

    // Mark line matched
    await tx
      .update(statementLines)
      .set({ matchStatus: 'matched' })
      .where(eq(statementLines.id, line.id));

    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'reconciliation_matched',
        entityType: 'statement_line',
        entityId: line.id,
        after: { paymentIds, totalAmountMinor: totalPaymentsMinor },
      });
    }

    return { success: true, matchedCount: candidatePayments.length };
  });
}

/**
 * Unmatches a previously reconciled statement line and resets payment statuses.
 */
export async function unmatchStatementLine(statementLineId: string, userId?: string) {
  return await db.transaction(async (tx) => {
    const matches = await tx
      .select()
      .from(reconciliationMatches)
      .where(eq(reconciliationMatches.statementLineId, statementLineId));

    if (matches.length === 0) {
      return { success: true, unmatchedCount: 0 };
    }

    const matchedPaymentIds = matches.map((m) => m.paymentId);

    // Delete matches
    await tx
      .delete(reconciliationMatches)
      .where(eq(reconciliationMatches.statementLineId, statementLineId));

    // Reset payments to unreconciled
    if (matchedPaymentIds.length > 0) {
      await tx
        .update(payments)
        .set({
          reconciliationStatus: 'unreconciled',
          reconciledAt: null,
          reconciledBy: null,
          reconciliationNote: null,
          updatedAt: getNow(),
        })
        .where(inArray(payments.id, matchedPaymentIds));
    }

    // Reset line status
    await tx
      .update(statementLines)
      .set({ matchStatus: 'unmatched' })
      .where(eq(statementLines.id, statementLineId));

    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'reconciliation_unmatched',
        entityType: 'statement_line',
        entityId: statementLineId,
        before: { matchedPaymentIds },
      });
    }

    return { success: true, unmatchedCount: matches.length };
  });
}

