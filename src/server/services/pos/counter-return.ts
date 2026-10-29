/**
 * Counter Return Service.
 *
 * Implements:
 *   - Atomic credit note + refund payment in one transaction
 *   - Manager override required for out-of-return-window returns
 *   - Return quantity capped at (sold qty - already returned qty)
 *   - Serial numbers returned to stock
 *   - Refund amount exactly equals credit note total
 *   - Walk-in customer credit balance must be 0 at end of transaction
 *   - Shift must be open at the counter location
 */

import { db } from '@/server/db';
import {
  salesDocuments,
  customers,
  posShifts,
  cardTerminals,
} from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { createCreditNoteWithTx } from '@/server/services/sales/credit-notes';
import { recordPaymentWithTx, getCustomerCredit } from '@/server/services/sales/payments';
import { verifyManagerOverride } from '@/server/services/pos/override';
import { getSetting } from '@/server/services/settings';
import { writeAuditLog } from '@/server/services/audit';
import { todayInCompanyTz, getNow } from '@/lib/timezone';
import type { CreditNoteLineInput } from '@/server/services/sales/credit-notes';

// ── Input / Output Types ──────────────────────────────────────────────────────

export interface CreateCounterReturnInput {
  /** The invoice to return against. */
  invoiceId: string;
  shiftId: string;
  locationId: string;
  cashierId: string;
  lines: CreditNoteLineInput[];
  /** Refund payment method. */
  refundMethod: 'cash' | 'card' | 'airtel_money' | 'mpamba';
  refundMethodDetails?: Record<string, unknown>;
  notes?: string;
  /** Manager override — required for out-of-return-window or large refunds. */
  managerOverride?: {
    pin: string;
    reason: string;
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export async function createCounterReturn(
  input: CreateCounterReturnInput,
  userId?: string,
) {
  // ── 1. Fetch the invoice (outside tx for early error checking) ────────────
  const [invoice] = await db
    .select()
    .from(salesDocuments)
    .where(eq(salesDocuments.id, input.invoiceId));

  if (!invoice) throw new Error('Invoice not found.');
  if (invoice.documentType !== 'invoice') {
    throw new Error(`Document ${invoice.documentNumber} is not an invoice.`);
  }
  if (invoice.status !== 'issued') {
    throw new Error(`Invoice '${invoice.documentNumber}' is not in 'issued' status.`);
  }

  // ── 2. Check return window ─────────────────────────────────────────────────
  const returnWindowDaysSetting = await getSetting('pos_return_window_days');
  const returnWindowDays =
    returnWindowDaysSetting !== undefined && returnWindowDaysSetting !== null
      ? Number(returnWindowDaysSetting)
      : 30;

  const issueDateMs = new Date(invoice.issueDate).getTime();
  const todayMs = new Date(todayInCompanyTz()).getTime();
  const daysDiff = Math.floor((todayMs - issueDateMs) / (1000 * 60 * 60 * 24));
  const isOutsideWindow = daysDiff > returnWindowDays;

  // ── 3. Verify manager override if needed ──────────────────────────────────
  let overrideApproverId: string | undefined;
  if (isOutsideWindow) {
    if (!input.managerOverride) {
      throw new Error(
        `Return is outside the ${returnWindowDays}-day window. Manager override required.`,
      );
    }
    const result = await verifyManagerOverride({
      pin: input.managerOverride.pin,
      cashierUserId: input.cashierId,
      action: 'counter_return_outside_window',
      reason: input.managerOverride.reason,
      metadata: { invoiceId: input.invoiceId, daysDiff },
    });
    overrideApproverId = result.approverId;
  } else if (input.managerOverride) {
    // Override provided but not required — verify anyway and record it
    const result = await verifyManagerOverride({
      pin: input.managerOverride.pin,
      cashierUserId: input.cashierId,
      action: 'counter_return_override',
      reason: input.managerOverride.reason,
    });
    overrideApproverId = result.approverId;
  }

  // ── 4. Atomic transaction ─────────────────────────────────────────────────
  return await db.transaction(async (tx) => {
    // Lock shift FOR SHARE
    const [shift] = await tx
      .select()
      .from(posShifts)
      .where(eq(posShifts.id, input.shiftId))
      .for('share');

    if (!shift) throw new Error('Shift not found.');
    if (shift.status !== 'open') {
      throw new Error(`Shift is not open (status: '${shift.status}').`);
    }
    if (shift.locationId !== input.locationId) {
      throw new Error('Shift location does not match return location.');
    }
    if (shift.cashierId !== input.cashierId) {
      throw new Error('Shift does not belong to the requesting cashier.');
    }

    // Create credit note (handles all validation, stock returns, serial recovery)
    const creditNote = await createCreditNoteWithTx(
      tx,
      {
        invoiceId: input.invoiceId,
        issueDate: todayInCompanyTz(),
        notes: input.notes,
        lines: input.lines,
        channel: 'counter',
        shiftId: input.shiftId,
      },
      userId,
      { skipWalkInCheck: true }, // We assert 0 balance ourselves at the end
    );

    // Record refund payment exactly equal to credit note total
    const creditNoteTotal = creditNote.totalMinor;

    // Validate references for non-cash refunds
    let resolvedRefundDetails = input.refundMethodDetails;
    if (input.refundMethod === 'card') {
      const details = (input.refundMethodDetails ?? {}) as Record<string, unknown>;
      const ref = details.slip_number ?? details.refund_slip_number ?? details.reference;
      if (!ref || String(ref).trim() === '') {
        throw new Error('Card refund requires a reference (terminal refund slip number).');
      }
      let terminalId = details.terminal_id as string | undefined;
      if (!terminalId) {
        const [term] = await tx
          .select({ id: cardTerminals.id })
          .from(cardTerminals)
          .where(and(eq(cardTerminals.locationId, input.locationId), eq(cardTerminals.isActive, true)))
          .limit(1);
        terminalId = term?.id;
      }
      if (!terminalId) {
        throw new Error('No active card terminal found at this location for card refund.');
      }
      resolvedRefundDetails = {
        ...details,
        terminal_id: terminalId,
        approval_code: (details.approval_code as string) ?? 'REFUND',
        slip_number: String(ref),
      };
    } else if (input.refundMethod === 'airtel_money' || input.refundMethod === 'mpamba') {
      const details = (input.refundMethodDetails ?? {}) as Record<string, unknown>;
      const ref = details.transaction_id ?? details.reference;
      if (!ref || String(ref).trim() === '') {
        throw new Error('Mobile money refund requires a reference (transaction ID).');
      }
      resolvedRefundDetails = {
        ...details,
        transaction_id: String(ref),
        sender_phone: (details.sender_phone as string) ?? '0000000000',
      };
    }

    const idempotencyKey = `${input.invoiceId}:return:${input.shiftId}:${getNow().getTime()}`;

    const refundResult = await recordPaymentWithTx(
      tx,
      {
        idempotencyKey,
        customerId: invoice.customerId,
        locationId: input.locationId,
        shiftId: input.shiftId,
        kind: 'refund',
        method: input.refundMethod,
        amountMinor: creditNoteTotal,
        paymentDate: todayInCompanyTz(),
        methodDetails: resolvedRefundDetails,
      },
      userId,
    );

    // Assert walk-in customer balance ends at 0
    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, invoice.customerId));

    if (customer?.isWalkIn) {
      const credit = await getCustomerCredit(invoice.customerId, tx);
      if (credit.creditMinor !== BigInt(0)) {
        throw new Error(
          `Walk-in customer credit must be zero after counter return. Found: ${credit.creditMinor}.`,
        );
      }
    }

    // Audit
    if (userId) {
      await writeAuditLog(tx, {
        userId,
        action: 'counter_return_created',
        entityType: 'sales_document',
        entityId: creditNote.id,
        after: {
          creditNoteNumber: creditNote.documentNumber,
          invoiceId: input.invoiceId,
          shiftId: input.shiftId,
          totalMinor: creditNoteTotal,
          refundMethod: input.refundMethod,
          overrideApproverId: overrideApproverId ?? null,
          outsideWindow: isOutsideWindow,
        },
      });
    }

    return {
      creditNote,
      refund: refundResult,
    };
  });
}
