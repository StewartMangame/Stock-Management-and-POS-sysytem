'use server';

import { createJournalBatch } from '@/server/services/accounting/journal-engine';
import { exportJournalBatchToCsv } from '@/server/services/accounting/batch-export';
import { db } from '@/server/db';
import { journalBatches } from '@/server/db/schema';
import { desc } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function listJournalBatchesAction() {
  return await db.select().from(journalBatches).orderBy(desc(journalBatches.createdAt));
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
