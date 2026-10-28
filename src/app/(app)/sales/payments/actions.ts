'use server';

import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import {
  recordPayment,
  confirmCheque,
  bounceCheque,
  allocatePayment,
  applyCreditToInvoice,
  reversePayment,
  refundPayment,
  markReconciled,
  getCustomerOpenInvoices,
  getCustomerCredit,
  type RecordPaymentInput,
} from '@/server/services/sales/payments';
import { revalidatePath } from 'next/cache';

export async function recordPaymentAction(input: RecordPaymentInput) {
  const actor = await authorize(PERMISSIONS.PAYMENTS_RECORD);
  const result = await recordPayment(input, actor.id);
  revalidatePath('/sales/payments');
  revalidatePath(`/sales/customers/${input.customerId}`);
  return result;
}

export async function confirmChequeAction(paymentId: string) {
  const actor = await authorize(PERMISSIONS.PAYMENTS_CHEQUE_CLEAR);
  const result = await confirmCheque(paymentId, actor.id);
  revalidatePath('/sales/payments');
  revalidatePath(`/sales/payments/${paymentId}`);
  return result;
}

export async function bounceChequeAction(paymentId: string, reason?: string) {
  const actor = await authorize(PERMISSIONS.PAYMENTS_CHEQUE_CLEAR);
  const result = await bounceCheque(paymentId, reason, actor.id);
  revalidatePath('/sales/payments');
  revalidatePath(`/sales/payments/${paymentId}`);
  return result;
}

export async function allocatePaymentAction(
  paymentId: string,
  allocations: Array<{ invoiceId: string; amountMinor: number }>,
) {
  const actor = await authorize(PERMISSIONS.PAYMENTS_RECORD);
  const result = await allocatePayment(paymentId, allocations, actor.id);
  revalidatePath('/sales/payments');
  revalidatePath(`/sales/payments/${paymentId}`);
  return result;
}

export async function applyCreditToInvoiceAction(
  customerId: string,
  invoiceId: string,
  amountMinor: number,
) {
  const actor = await authorize(PERMISSIONS.PAYMENTS_RECORD);
  const result = await applyCreditToInvoice(customerId, invoiceId, amountMinor, actor.id);
  revalidatePath('/sales/payments');
  revalidatePath(`/sales/customers/${customerId}`);
  revalidatePath(`/sales/invoices/${invoiceId}`);
  return result;
}

export async function reversePaymentAction(paymentId: string, reason: string) {
  const actor = await authorize(PERMISSIONS.PAYMENTS_REVERSE);
  const result = await reversePayment(paymentId, reason, actor.id);
  revalidatePath('/sales/payments');
  revalidatePath(`/sales/payments/${paymentId}`);
  return result;
}

export async function refundPaymentAction(input: {
  customerId: string;
  locationId: string;
  amountMinor: number;
  method: any;
  methodDetails?: unknown;
  notes?: string;
  idempotencyKey?: string;
}) {
  const actor = await authorize(PERMISSIONS.PAYMENTS_REFUND);
  await authorize(PERMISSIONS.REFUNDS_APPROVE);
  const result = await refundPayment(input, actor.id);
  revalidatePath('/sales/payments');
  revalidatePath(`/sales/customers/${input.customerId}`);
  return result;
}

export async function markReconciledAction(paymentId: string, note?: string) {
  const actor = await authorize(PERMISSIONS.PAYMENTS_RECONCILE);
  const result = await markReconciled(paymentId, note, actor.id);
  revalidatePath('/sales/payments');
  revalidatePath('/sales/payments/unreconciled');
  revalidatePath(`/sales/payments/${paymentId}`);
  return result;
}

export async function getCustomerOpenInvoicesAction(customerId: string) {
  await authorize(PERMISSIONS.PAYMENTS_VIEW);
  return await getCustomerOpenInvoices(customerId);
}

export async function getCustomerCreditAction(customerId: string) {
  await authorize(PERMISSIONS.PAYMENTS_VIEW);
  const result = await getCustomerCredit(customerId);
  return {
    creditMinor: Number(result.creditMinor),
    confirmedReceipts: Number(result.confirmedReceipts),
    netAllocations: Number(result.netAllocations),
    confirmedRefunds: Number(result.confirmedRefunds),
  };
}
