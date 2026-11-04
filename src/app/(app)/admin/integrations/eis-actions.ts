'use server';
/**
 * EIS Queue Server Actions.
 * resendEisSubmission: re-queues a failed or rejected EIS submission.
 * correctAndResendEisSubmission: allows manager to edit the payload before re-queuing.
 */
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { eisSubmissions } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { writeAuditLog } from '@/server/services/audit';
import { revalidatePath } from 'next/cache';
import { getNow } from '@/lib/timezone';

export async function resendEisSubmissionAction(submissionId: string) {
  const actor = await authorize(PERMISSIONS.SETTINGS_MANAGE);

  const [sub] = await db
    .select()
    .from(eisSubmissions)
    .where(eq(eisSubmissions.id, submissionId));

  if (!sub) throw new Error(`EIS submission '${submissionId}' not found.`);
  if (sub.status === 'accepted') {
    throw new Error('Cannot resend an already-accepted EIS submission.');
  }

  // Reset to pending so the cron picks it up on its next run
  await db
    .update(eisSubmissions)
    .set({
      status: 'pending',
      attempts: 0,
      errorMessage: null,
      nextRetryAt: getNow(),
    })
    .where(eq(eisSubmissions.id, submissionId));

  await writeAuditLog(db, {
    userId: actor.id,
    action: 'eis_submission_resent',
    entityType: 'eis_submission',
    entityId: submissionId,
    after: { resendBy: actor.id, reason: 'Manual resend from EIS queue' },
  });

  revalidatePath('/admin/integrations');
  return { success: true };
}

export async function correctAndResendEisSubmissionAction(
  submissionId: string,
  correctedPayload: Record<string, unknown>,
) {
  const actor = await authorize(PERMISSIONS.SETTINGS_MANAGE);

  const [sub] = await db
    .select()
    .from(eisSubmissions)
    .where(eq(eisSubmissions.id, submissionId));

  if (!sub) throw new Error(`EIS submission '${submissionId}' not found.`);
  if (sub.status === 'accepted') {
    throw new Error('Cannot correct an already-accepted EIS submission.');
  }

  await db
    .update(eisSubmissions)
    .set({
      status: 'pending',
      attempts: 0,
      errorMessage: null,
      nextRetryAt: getNow(),
      payload: correctedPayload,
    })
    .where(eq(eisSubmissions.id, submissionId));

  await writeAuditLog(db, {
    userId: actor.id,
    action: 'eis_submission_corrected_and_resent',
    entityType: 'eis_submission',
    entityId: submissionId,
    before: { status: sub.status },
    after: { correctedBy: actor.id },
  });

  revalidatePath('/admin/integrations');
  return { success: true };
}
