'use server';

import { createJournalBatch } from '@/server/services/accounting/journal-engine';
import { exportJournalBatchToCsv } from '@/server/services/accounting/batch-export';
import { db } from '@/server/db';
import { journalBatches, journalBatchExports } from '@/server/db/schema';
import { desc } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function listJournalBatchesAction() {
  const batches = await db.select().from(journalBatches).orderBy(desc(journalBatches.createdAt));
  const exports = await db.select().from(journalBatchExports);
  const exportMap = new Map<string, (typeof exports)[0]>();
  for (const exp of exports) {
    const existing = exportMap.get(exp.batchId);
    if (!existing || new Date(exp.exportedAt) > new Date(existing.exportedAt)) {
      exportMap.set(exp.batchId, exp);
    }
  }
  return batches.map((b) => {
    const latestExp = exportMap.get(b.id);
    return {
      ...b,
      status: latestExp ? 'exported' : 'unexported',
      exportedAt: latestExp?.exportedAt ?? b.exportedAt,
      exportedBy: latestExp?.exportedBy ?? b.exportedBy,
      reExportApprovedBy: latestExp?.reExportApprovedBy ?? b.reExportApprovedBy,
      reExportApprovedAt: latestExp?.reExportApprovedAt ?? b.reExportApprovedAt,
      reExportReason: latestExp?.reExportReason ?? b.reExportReason,
    };
  });
}

export async function generateBatchAction(periodStartStr: string, periodEndStr: string) {
  const start = new Date(periodStartStr);
  const end = new Date(periodEndStr);
  const result = await createJournalBatch(start, end);
  revalidatePath('/accounting/batches');
  return result;
}

export async function exportBatchCsvAction(
  batchId: string,
  reExportApproval?: { approvedByManagerId: string; reason: string },
) {
  const result = await exportJournalBatchToCsv(batchId, '00000000-0000-0000-0000-000000000001', reExportApproval);
  revalidatePath('/accounting/batches');
  return result;
}
