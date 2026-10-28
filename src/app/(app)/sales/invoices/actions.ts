'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import {
  createDirectInvoice,
  issueInvoice,
  voidInvoice,
} from '@/server/services/sales/invoices';
import type { CreateInvoiceInput } from '@/server/services/sales/invoices';

export async function createDirectInvoiceAction(input: CreateInvoiceInput) {
  const actor = await authorize(PERMISSIONS.INVOICES_MANAGE);
  const invoice = await createDirectInvoice(input, actor.id);
  revalidatePath('/sales/invoices');
  return { success: true, invoice };
}

export async function issueInvoiceAction(
  invoiceId: string,
  options?: { managerApproved?: boolean; approvalReason?: string },
) {
  const actor = await authorize(PERMISSIONS.INVOICES_MANAGE);
  if (options?.managerApproved) {
    // If manager approval is being claimed, verify manager has permission
    await authorize(PERMISSIONS.DISCOUNTS_APPROVE);
  }
  const invoice = await issueInvoice(invoiceId, actor.id, options);
  revalidatePath('/sales/invoices');
  revalidatePath(`/sales/invoices/${invoiceId}`);
  return { success: true, invoice };
}

export async function voidInvoiceAction(invoiceId: string, reason?: string) {
  const actor = await authorize(PERMISSIONS.INVOICES_VOID);
  const invoice = await voidInvoice(invoiceId, actor.id, reason);
  revalidatePath('/sales/invoices');
  revalidatePath(`/sales/invoices/${invoiceId}`);
  return { success: true, invoice };
}
