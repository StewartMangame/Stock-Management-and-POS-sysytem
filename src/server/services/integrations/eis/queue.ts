/**
 * EIS Outbox Queue Service.
 * Implements transactional outbox pattern with exponential retry backoff.
 */

import { db, type DbTransaction } from '@/server/db';
import {
  eisSubmissions,
  salesDocuments,
  salesDocumentLines,
  customers,
} from '@/server/db/schema';
import { eq, and, sql, lte, lt } from 'drizzle-orm';
import { getEisAdapter } from './mock';
import { EisSubmissionPayload } from './types';
import { getNow } from '@/lib/timezone';

/**
 * Enqueues an invoice or credit note for EIS submission inside an active transaction.
 */
export async function enqueueEisSubmission(
  tx: DbTransaction,
  documentId: string,
  documentType: 'invoice' | 'credit_note',
) {
  const [doc] = await tx
    .select()
    .from(salesDocuments)
    .where(eq(salesDocuments.id, documentId));

  if (!doc) throw new Error(`Document '${documentId}' not found for EIS submission.`);

  const [cust] = await tx
    .select()
    .from(customers)
    .where(eq(customers.id, doc.customerId));

  const lines = await tx
    .select()
    .from(salesDocumentLines)
    .where(eq(salesDocumentLines.documentId, doc.id));

  const payload: EisSubmissionPayload = {
    documentId: doc.id,
    documentNumber: doc.documentNumber ?? '',
    documentType,
    issueDate: doc.issueDate,
    currency: doc.currency,
    subtotalMinor: doc.subtotalMinor,
    taxMinor: doc.taxMinor,
    totalMinor: doc.totalMinor,
    customer: {
      name: cust?.name ?? 'Customer',
      tin: cust?.taxNumber ?? undefined,
    },
    lines: lines.map((l, idx) => ({
      lineNumber: idx + 1,
      description: l.description ?? '',
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      taxRateBasisPoints: l.taxRateBasisPoints,
      taxMinor: l.taxMinor,
      lineTotalMinor: l.lineTotalMinor,
    })),
  };

  const [submission] = await tx
    .insert(eisSubmissions)
    .values({
      documentId: doc.id,
      documentType,
      status: 'pending',
      attempts: 0,
      nextRetryAt: getNow(),
      payload,
    })
    .returning();

  return submission!;
}

/**
 * Processes pending items in the EIS transactional outbox.
 */
export async function processEisOutboxBatch(batchSize = 10) {
  const now = getNow();

  // Find submissions ready for retry
  const pendingSubmissions = await db
    .select()
    .from(eisSubmissions)
    .where(
      and(
        sql`${eisSubmissions.status} IN ('pending', 'processing')`,
        lte(eisSubmissions.nextRetryAt, new Date(now.getTime() + 10000)),
        lt(eisSubmissions.attempts, 5),
        sql`(${eisSubmissions.lockedAt} IS NULL OR ${eisSubmissions.lockedAt} < ${new Date(now.getTime() - 5 * 60 * 1000)})`,
      ),
    )
    .limit(batchSize);

  if (pendingSubmissions.length === 0) {
    return { processedCount: 0, successCount: 0, failedCount: 0 };
  }

  let successCount = 0;
  let failedCount = 0;
  const adapter = getEisAdapter();

  for (const sub of pendingSubmissions) {
    // Acquire lock
    await db
      .update(eisSubmissions)
      .set({ status: 'processing', lockedAt: now })
      .where(eq(eisSubmissions.id, sub.id));

    try {
      const payload = sub.payload as unknown as EisSubmissionPayload;
      const res = await adapter.submit(payload);

      if (res.success) {
        await db.transaction(async (tx) => {
          await tx
            .update(eisSubmissions)
            .set({
              status: 'accepted',
              responsePayload: {
                ...(res.rawResponse ?? {}),
                receiptNumber: res.receiptNumber,
                qrCodeData: res.qrCodeData,
              },
              lockedAt: null,
            })
            .where(eq(eisSubmissions.id, sub.id));

          // Update sales document with EIS acceptance info
          await tx
            .update(salesDocuments)
            .set({
              eisStatus: 'accepted',
              eisReference: res.receiptNumber,
              eisQrCode: res.qrCodeData,
              updatedAt: getNow(),
            })
            .where(eq(salesDocuments.id, sub.documentId));
        });
        successCount++;
      } else {
        const nextAttempts = sub.attempts + 1;
        const delaySeconds = Math.pow(2, nextAttempts) * 30; // 30s, 60s, 120s, 240s...
        const nextRetry = new Date(now.getTime() + delaySeconds * 1000);

        await db
          .update(eisSubmissions)
          .set({
            status: nextAttempts >= 5 ? 'failed' : 'pending',
            attempts: nextAttempts,
            nextRetryAt: nextRetry,
            errorMessage: res.errorMessage || 'EIS submission declined',
            lockedAt: null,
          })
          .where(eq(eisSubmissions.id, sub.id));

        failedCount++;
      }
    } catch (err: any) {
      const nextAttempts = sub.attempts + 1;
      const delaySeconds = Math.pow(2, nextAttempts) * 30;
      const nextRetry = new Date(now.getTime() + delaySeconds * 1000);

      await db
        .update(eisSubmissions)
        .set({
          status: nextAttempts >= 5 ? 'failed' : 'pending',
          attempts: nextAttempts,
          nextRetryAt: nextRetry,
          errorMessage: err.message || 'Fatal EIS worker error',
          lockedAt: null,
        })
        .where(eq(eisSubmissions.id, sub.id));

      failedCount++;
    }
  }

  return {
    processedCount: pendingSubmissions.length,
    successCount,
    failedCount,
  };
}

/**
 * Retrieves EIS receipt and QR code data for an issued document.
 */
export async function getEisReceiptData(documentId: string) {
  const [sub] = await db
    .select()
    .from(eisSubmissions)
    .where(eq(eisSubmissions.documentId, documentId));

  if (!sub || sub.status !== 'accepted') {
    return null;
  }

  const raw = sub.responsePayload as any;
  return {
    status: sub.status,
    receiptNumber: raw?.receiptNumber || 'MRA-RECEIPT',
    deviceSerialNumber: raw?.deviceSerialNumber || 'MRA-DEVICE',
    qrCodeData: raw?.qrCodeData || `https://mra.mw/verify?rn=${raw?.receiptNumber}`,
  };
}

