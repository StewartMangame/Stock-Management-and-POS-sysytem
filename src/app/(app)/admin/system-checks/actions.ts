'use server';

import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { runSystemChecks, getSystemChecksHistory } from '@/server/services/system-checks';
import { revalidatePath } from 'next/cache';

export async function runSystemChecksAction() {
  const actor = await authorize(PERMISSIONS.SYSTEM_CHECKS_RUN);
  const result = await runSystemChecks(actor.id);
  revalidatePath('/admin/system-checks');
  return { success: true, result };
}

export async function getSystemChecksHistoryAction() {
  await authorize(PERMISSIONS.SYSTEM_CHECKS_RUN);
  const history = await getSystemChecksHistory(20);
  return { success: true, history };
}

