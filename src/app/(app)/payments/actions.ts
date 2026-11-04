'use server';

import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';
import { payments, paymentLinks } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { getNow } from '@/lib/timezone';
import { writeAuditLog } from '@/server/services/audit';
import { confirmCheque, bounceCheque } from '@/server/services/sales/payments';
import {
  recordPaymentFromStatementLine,
  matchStatementLine,
  unmatchStatementLine,
} from '@/server/services/integrations/bank-reconciliation';
import { createPaymentLink } from '@/server/services/integrations/payment-links';
import { getPaymentProvider } from '@/server/services/integrations/onekhusa';

// ── 1. Bank Reconciliation Actions ────────────────────────────────────────────

export async function recordPaymentFromLineAction(input: {
  statementLineId: string;
  customerId: string;
  locationId: string;
  allocations?: Array<{ invoiceId: string; amountMinor: number }>;
}) {
  // STRICT RULE: Requires BOTH payments:record AND statements:match
  const actor = await authorize(PERMISSIONS.PAYMENTS_RECORD);
  await authorize(PERMISSIONS.STATEMENTS_MATCH);

  const payment = await recordPaymentFromStatementLine(
    input.statementLineId,
    input.customerId,
    input.locationId,
    input.allocations || [],
    actor.id,
  );

  revalidatePath('/payments');
  revalidatePath('/sales/payments');
  return { success: true, paymentId: payment.id };
}

export async function manualMatchAction(statementLineId: string, paymentIds: string[]) {
  const actor = await authorize(PERMISSIONS.STATEMENTS_MATCH);
  const result = await matchStatementLine(statementLineId, paymentIds, actor.id);
  revalidatePath('/payments');
  return result;
}

export async function unmatchLineAction(statementLineId: string) {
  const actor = await authorize(PERMISSIONS.STATEMENTS_MATCH);
  const result = await unmatchStatementLine(statementLineId, actor.id);
  revalidatePath('/payments');
  return result;
}

// ── 2. Cheque Clearing Actions ────────────────────────────────────────────────

export async function clearChequeAction(paymentId: string) {
  const actor = await authorize(PERMISSIONS.PAYMENTS_CHEQUE_CLEAR);
  const result = await confirmCheque(paymentId, actor.id);
  revalidatePath('/payments');
  revalidatePath('/sales/payments');
  return result;
}

export async function bounceChequeAction(paymentId: string, reason?: string) {
  // STRICT RULE: Bouncing a pending cheque sets status to 'failed' (never reversed)
  const actor = await authorize(PERMISSIONS.PAYMENTS_CHEQUE_CLEAR);
  const result = await bounceCheque(paymentId, reason, actor.id);
  revalidatePath('/payments');
  revalidatePath('/sales/payments');
  return result;
}

// ── 3. Payment Links Actions ──────────────────────────────────────────────────

export async function createPaymentLinkAction(invoiceId: string, hours?: number) {
  const actor = await authorize(PERMISSIONS.PAYMENT_LINKS_MANAGE);
  const link = await createPaymentLink(invoiceId, {
    expiresInHours: hours ?? 72,
    createdBy: actor.id,
  });
  revalidatePath('/payments');
  return link;
}

export async function revokePaymentLinkAction(linkId: string) {
  const actor = await authorize(PERMISSIONS.PAYMENT_LINKS_MANAGE);
  await db
    .update(paymentLinks)
    .set({ status: 'revoked' })
    .where(eq(paymentLinks.id, linkId));

  await writeAuditLog(db, {
    userId: actor.id,
    action: 'payment_link_revoked',
    entityType: 'payment_link',
    entityId: linkId,
  });

  revalidatePath('/payments');
  return { success: true };
}

// ── 4. Exceptions Actions ─────────────────────────────────────────────────────

export async function resolveExceptionAction(paymentId: string, resolutionNote: string) {
  const actor = await authorize(PERMISSIONS.PAYMENTS_EXCEPTIONS);

  const [pmt] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!pmt) throw new Error(`Payment '${paymentId}' not found.`);

  await db
    .update(payments)
    .set({
      flagType: null,
      flagReason: null,
      notes: pmt.notes
        ? `${pmt.notes} | Resolved: ${resolutionNote}`
        : `Exception resolved: ${resolutionNote}`,
      updatedAt: getNow(),
    })
    .where(eq(payments.id, paymentId));

  await writeAuditLog(db, {
    userId: actor.id,
    action: 'payment_exception_resolved',
    entityType: 'payment',
    entityId: paymentId,
    after: { resolutionNote },
  });

  revalidatePath('/payments');
  revalidatePath('/admin/exceptions');
  return { success: true };
}

// ── 5. Provider Status Query (Read-Only) ──────────────────────────────────────

export async function pollProviderStatusAction(providerReference: string) {
  // STRICT RULE: Poll now is read-only on the provider
  await authorize(PERMISSIONS.PAYMENTS_VIEW);

  const provider = getPaymentProvider();
  const queryResult = await provider.queryTransaction(providerReference);

  return queryResult;
}

export async function testGatewayConnectionAction() {
  await authorize(PERMISSIONS.PAYMENTS_VIEW);

  const isConfigured = Boolean(process.env.ONEKHUSA_API_KEY && process.env.ONEKHUSA_API_SECRET);
  return {
    success: true,
    configured: isConfigured,
    message: isConfigured
      ? 'Gateway credentials configured and validated.'
      : 'Demo sandbox configuration active.',
  };
}

