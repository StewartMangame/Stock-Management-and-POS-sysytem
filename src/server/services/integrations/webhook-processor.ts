/**
 * Webhook Processor Service.
 * Asynchronously processes raw events stored in webhook_inbox with idempotency and safety checks.
 */

import { db } from '@/server/db';
import {
  webhookInbox,
  payments,
  paymentAllocations,
  salesDocuments,
  paymentLinks,
} from '@/server/db/schema';
import { eq, and, sql, or } from 'drizzle-orm';
import { getPaymentProvider } from './onekhusa';
import { getNow } from '@/lib/timezone';

export async function processWebhookInboxItem(inboxId: string): Promise<{ success: boolean; message: string }> {
  const [inbox] = await db
    .select()
    .from(webhookInbox)
    .where(eq(webhookInbox.id, inboxId));

  if (!inbox) {
    return { success: false, message: 'Inbox item not found.' };
  }

  if (inbox.status === 'processed') {
    return { success: true, message: 'Already processed.' };
  }

  const provider = getPaymentProvider();
  const verified = provider.verifyWebhook(inbox.rawPayload, inbox.headers as Record<string, string>);

  if (!verified.isValid) {
    await db
      .update(webhookInbox)
      .set({ status: 'failed', errorMessage: verified.error || 'Verification failed', processedAt: getNow() })
      .where(eq(webhookInbox.id, inboxId));
    return { success: false, message: verified.error || 'Invalid signature' };
  }

  // Find payment: match by sourceReferenceNumber (our paymentId) or providerReference
  let [payment] = await db
    .select()
    .from(payments)
    .where(
      or(
        verified.sourceReferenceNumber ? eq(payments.id, verified.sourceReferenceNumber) : sql`false`,
        verified.transactionReference ? eq(payments.providerReference, verified.transactionReference) : sql`false`,
      ),
    );

  if (!payment) {
    await db
      .update(webhookInbox)
      .set({
        status: 'ignored',
        errorMessage: `Payment not found for ref '${verified.sourceReferenceNumber || verified.transactionReference}'`,
        processedAt: getNow(),
      })
      .where(eq(webhookInbox.id, inboxId));
    return { success: false, message: 'Payment record not found' };
  }

  // 1. Amount & Currency Safety Checks
  if (verified.amountMinor !== undefined && verified.amountMinor !== payment.amountMinor) {
    await db
      .update(payments)
      .set({
        flagType: 'amount_mismatch',
        flagReason: `Webhook amount ${verified.amountMinor} MWK tambala does not match payment expected ${payment.amountMinor}`,
        flaggedAt: getNow(),
        updatedAt: getNow(),
      })
      .where(eq(payments.id, payment.id));

    await db
      .update(webhookInbox)
      .set({ status: 'failed', errorMessage: 'Amount mismatch flagged', processedAt: getNow() })
      .where(eq(webhookInbox.id, inboxId));

    return { success: false, message: 'Amount mismatch flagged' };
  }

  if (verified.currency && verified.currency.toUpperCase() !== payment.currency.toUpperCase()) {
    await db
      .update(payments)
      .set({
        flagType: 'currency_mismatch',
        flagReason: `Webhook currency ${verified.currency} does not match expected ${payment.currency}`,
        flaggedAt: getNow(),
        updatedAt: getNow(),
      })
      .where(eq(payments.id, payment.id));

    await db
      .update(webhookInbox)
      .set({ status: 'failed', errorMessage: 'Currency mismatch flagged', processedAt: getNow() })
      .where(eq(webhookInbox.id, inboxId));

    return { success: false, message: 'Currency mismatch flagged' };
  }

  // 2. Out-of-order check: if payment is already failed or reversed, do NOT automatically resurrect it
  if (payment.status === 'failed' || payment.status === 'reversed') {
    if (verified.status === 'confirmed') {
      await db
        .update(payments)
        .set({
          flagType: 'out_of_order',
          flagReason: `Provider reported success, but payment was already in terminal state '${payment.status}'. Manager intervention required.`,
          flaggedAt: getNow(),
          providerConfirmedAt: getNow(),
          providerFeeMinor: verified.feeMinor ?? 0,
          providerNetMinor: verified.netMinor,
          updatedAt: getNow(),
        })
        .where(eq(payments.id, payment.id));

      await db
        .update(webhookInbox)
        .set({ status: 'processed', errorMessage: 'Flagged out-of-order success on terminal payment', processedAt: getNow() })
        .where(eq(webhookInbox.id, inboxId));

      return { success: true, message: 'Flagged out-of-order payment' };
    }
  }

  // 3. Process Status Updates
  if (verified.status === 'confirmed') {
    if (payment.status === 'pending') {
      // Is this a POS sale prompt (has shiftId) or an online invoice payment (has intendedAllocations)?
      if (payment.shiftId) {
        // POS payment: transitions to awaiting_sale until counter sale transaction consumes it
        await db
          .update(payments)
          .set({
            status: 'awaiting_sale',
            providerReference: verified.transactionReference || payment.providerReference,
            providerConfirmedAt: getNow(),
            providerFeeMinor: verified.feeMinor ?? 0,
            providerNetMinor: verified.netMinor,
            updatedAt: getNow(),
          })
          .where(eq(payments.id, payment.id));
      } else {
        // Online invoice payment: execute in transaction to confirm and allocate to invoice
        await db.transaction(async (tx) => {
          const [confirmedPmt] = await tx
            .update(payments)
            .set({
              status: 'confirmed',
              confirmedAt: getNow(),
              providerConfirmedAt: getNow(),
              providerReference: verified.transactionReference || payment.providerReference,
              providerFeeMinor: verified.feeMinor ?? 0,
              providerNetMinor: verified.netMinor,
              updatedAt: getNow(),
            })
            .where(eq(payments.id, payment.id))
            .returning();

          // Allocate to intended invoice
          const allocs = (payment.intendedAllocations as Array<{ invoiceId: string; amountMinor: number }>) ?? [];
          for (const a of allocs) {
            await tx.insert(paymentAllocations).values({
              paymentId: confirmedPmt!.id,
              invoiceId: a.invoiceId,
              amountMinor: a.amountMinor,
              notes: 'Online payment link automated allocation',
            });

            // Update invoice balances
            const [inv] = await tx
              .update(salesDocuments)
              .set({
                paidMinor: sql`${salesDocuments.paidMinor} + ${a.amountMinor}`,
                balanceMinor: sql`${salesDocuments.balanceMinor} - ${a.amountMinor}`,
                updatedAt: getNow(),
              })
              .where(eq(salesDocuments.id, a.invoiceId))
              .returning();

            // If fully paid, mark invoice and payment link as paid
            if (inv && inv.balanceMinor <= 0) {
              await tx
                .update(salesDocuments)
                .set({ paymentStatus: 'paid', updatedAt: getNow() })
                .where(eq(salesDocuments.id, inv.id));

              await tx
                .update(paymentLinks)
                .set({ status: 'paid' })
                .where(eq(paymentLinks.invoiceId, inv.id));
            }
          }
        });
      }
    }
  } else if (verified.status === 'failed') {
    if (payment.status === 'pending') {
      await db
        .update(payments)
        .set({
          status: 'failed',
          reversalReason: 'Provider webhook reported payment failure or declined',
          updatedAt: getNow(),
        })
        .where(eq(payments.id, payment.id));
    }
  } else if (verified.status === 'reversed') {
    // Flag provider reversal event for manager review
    await db
      .update(payments)
      .set({
        flagType: 'excess_credit',
        flagReason: 'Provider sent reversal webhook event. Reversal requires manager review.',
        flaggedAt: getNow(),
        updatedAt: getNow(),
      })
      .where(eq(payments.id, payment.id));
  }

  await db
    .update(webhookInbox)
    .set({
      status: 'processed',
      processedAt: getNow(),
    })
    .where(eq(webhookInbox.id, inboxId));

  return { success: true, message: 'Processed successfully' };
}

