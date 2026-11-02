/**
 * POS Mobile Money Service.
 * Coordinates direct push payments (Airtel Money, TNM Mpamba) at the counter POS.
 */

import { db } from '@/server/db';
import { payments, posShifts, customers } from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getPaymentProvider, normalizeMalawianPhone } from '@/server/services/integrations/onekhusa';
import { nextSequenceNumber } from '@/server/services/sequences';
import { todayInCompanyTz, getNow } from '@/lib/timezone';

export interface InitiatePosPushInput {
  shiftId: string;
  locationId: string;
  cashierId: string;
  customerId?: string;
  method: 'airtel_money' | 'mpamba';
  phone: string;
  amountMinor: number;
}

export interface InitiatePosPushResult {
  paymentId: string;
  providerReference?: string;
  status: 'pending' | 'failed';
  errorMessage?: string;
}

export async function initiatePosMobileMoneyPrompt(
  input: InitiatePosPushInput,
): Promise<InitiatePosPushResult> {
  // 1. Verify shift
  const [shift] = await db
    .select()
    .from(posShifts)
    .where(eq(posShifts.id, input.shiftId));

  if (!shift || shift.status !== 'open') {
    throw new Error('Active shift is required to initiate POS mobile money payment.');
  }

  // 2. Validate phone
  const phoneVal = normalizeMalawianPhone(input.phone);
  if (!phoneVal.valid) {
    throw new Error(`Invalid phone number '${input.phone}'. Malawian numbers start with 8 (Airtel) or 9 (TNM).`);
  }

  // 3. Resolve customer (default walk-in)
  let custId = input.customerId;
  if (!custId) {
    const [walkIn] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.isWalkIn, true));
    if (!walkIn) throw new Error('Walk-in customer record not found.');
    custId = walkIn.id;
  }

  const today = todayInCompanyTz();
  const paymentNumber = await nextSequenceNumber(db, 'payment', input.locationId);
  const idempotencyKey = `pos-push-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 4. Create pending payment record
  const [payment] = await db
    .insert(payments)
    .values({
      paymentNumber,
      idempotencyKey,
      customerId: custId,
      locationId: input.locationId,
      shiftId: input.shiftId,
      kind: 'receipt',
      method: input.method,
      amountMinor: input.amountMinor,
      status: 'pending',
      provider: 'onekhusa',
      paymentDate: today,
      methodDetails: {
        phone: phoneVal.normalized,
        network: phoneVal.network,
      },
      createdBy: input.cashierId,
    })
    .returning();

  // 5. Call OneKhusa Provider
  const provider = getPaymentProvider();
  const pushRes = await provider.initiatePush({
    paymentId: payment!.id,
    amountMinor: input.amountMinor,
    currency: 'MWK',
    payerPhone: phoneVal.normalized,
    description: `POS Counter Sale (${paymentNumber})`,
    idempotencyKey,
    capturedBy: input.cashierId,
    sourceReferenceNumber: payment!.id,
  });

  if (!pushRes.success) {
    // Update payment as failed
    await db
      .update(payments)
      .set({
        status: 'failed',
        reversalReason: pushRes.errorMessage || 'Provider push prompt rejected',
        updatedAt: getNow(),
      })
      .where(eq(payments.id, payment!.id));

    return {
      paymentId: payment!.id,
      status: 'failed',
      errorMessage: pushRes.errorMessage || 'Failed to initiate mobile money prompt',
    };
  }

  // Update payment with provider reference
  await db
    .update(payments)
    .set({
      providerReference: pushRes.providerReference,
      providerStatus: pushRes.providerStatus,
      updatedAt: getNow(),
    })
    .where(eq(payments.id, payment!.id));

  return {
    paymentId: payment!.id,
    providerReference: pushRes.providerReference,
    status: 'pending',
  };
}

export async function checkPosMobileMoneyStatus(paymentId: string) {
  const [pmt] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!pmt) throw new Error(`Payment '${paymentId}' not found.`);

  // If already reached terminal state or awaiting_sale (e.g. from webhook)
  if (pmt.status === 'awaiting_sale') {
    return { status: 'awaiting_sale', paymentId: pmt.id };
  }
  if (pmt.status === 'confirmed') {
    return { status: 'confirmed', paymentId: pmt.id };
  }
  if (pmt.status === 'failed' || pmt.status === 'reversed') {
    return {
      status: pmt.status,
      errorMessage: pmt.reversalReason || 'Payment failed or was cancelled.',
    };
  }

  // Still pending: query provider
  if (pmt.providerReference) {
    const provider = getPaymentProvider();
    const query = await provider.queryTransaction(pmt.providerReference);

    if (query.status === 'confirmed') {
      const [updated] = await db
        .update(payments)
        .set({
          status: 'awaiting_sale',
          providerConfirmedAt: getNow(),
          providerFeeMinor: query.feeMinor,
          providerNetMinor: query.netMinor,
          updatedAt: getNow(),
        })
        .where(and(eq(payments.id, pmt.id), eq(payments.status, 'pending')))
        .returning();

      if (updated) {
        return { status: 'awaiting_sale', paymentId: pmt.id };
      }
    } else if (query.status === 'failed') {
      await db
        .update(payments)
        .set({
          status: 'failed',
          reversalReason: query.providerStatusName || 'Mobile money prompt failed/declined',
          updatedAt: getNow(),
        })
        .where(and(eq(payments.id, pmt.id), eq(payments.status, 'pending')));

      return { status: 'failed', errorMessage: 'Customer declined or prompt expired' };
    }
  }

  return { status: 'pending', paymentId: pmt.id };
}

export async function cancelPosMobileMoneyPrompt(
  paymentId: string,
  reason: string,
  cashierId: string,
) {
  const [pmt] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!pmt) throw new Error(`Payment '${paymentId}' not found.`);

  if (pmt.status === 'pending') {
    await db
      .update(payments)
      .set({
        status: 'failed',
        reversalReason: `Cancelled by cashier: ${reason}`,
        updatedAt: getNow(),
      })
      .where(eq(payments.id, paymentId));

    return { cancelled: true, status: 'failed' };
  }

  if (pmt.status === 'awaiting_sale') {
    // If funds were received by gateway but sale not completed, refund/reverse per state machine
    await db
      .update(payments)
      .set({
        status: 'reversed',
        reversalReason: `Cashier cancelled sale after prompt confirmed: ${reason}`,
        reversedAt: getNow(),
        reversedBy: cashierId,
        methodDetails: {
          ...(typeof pmt.methodDetails === 'object' && pmt.methodDetails !== null ? pmt.methodDetails : {}),
          refund_reference: `REV-${Date.now()}`,
        },
        updatedAt: getNow(),
      })
      .where(eq(payments.id, paymentId));

    return { cancelled: true, status: 'reversed' };
  }

  return { cancelled: false, status: pmt.status };
}

