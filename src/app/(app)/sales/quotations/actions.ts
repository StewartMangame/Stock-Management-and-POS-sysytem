'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import {
  createQuotation,
  sendQuotation,
  acceptQuotation,
  cancelQuotation,
  extendQuotationReservationExpiry,
} from '@/server/services/sales/quotations';
import { convertQuotationToInvoice } from '@/server/services/sales/invoices';
import type { CreateQuotationInput } from '@/server/services/sales/quotations';

export async function createQuotationAction(input: CreateQuotationInput) {
  const actor = await authorize(PERMISSIONS.QUOTATIONS_MANAGE);
  const quote = await createQuotation(input, actor.id);
  revalidatePath('/sales/quotations');
  return { success: true, quotation: quote };
}

export async function sendQuotationAction(id: string) {
  const actor = await authorize(PERMISSIONS.QUOTATIONS_MANAGE);
  const quote = await sendQuotation(id, actor.id);
  revalidatePath('/sales/quotations');
  revalidatePath(`/sales/quotations/${id}`);
  return { success: true, quotation: quote };
}

export async function acceptQuotationAction(id: string, options?: { allowShortfallPartial?: boolean }) {
  const actor = await authorize(PERMISSIONS.QUOTATIONS_MANAGE);
  const quote = await acceptQuotation(id, actor.id, options);
  revalidatePath('/sales/quotations');
  revalidatePath(`/sales/quotations/${id}`);
  return { success: true, quotation: quote };
}

export async function cancelQuotationAction(id: string) {
  const actor = await authorize(PERMISSIONS.QUOTATIONS_MANAGE);
  const quote = await cancelQuotation(id, actor.id);
  revalidatePath('/sales/quotations');
  revalidatePath(`/sales/quotations/${id}`);
  return { success: true, quotation: quote };
}

export async function convertQuotationToInvoiceAction(id: string) {
  const actor = await authorize(PERMISSIONS.INVOICES_MANAGE);
  const invoice = await convertQuotationToInvoice(id, actor.id);
  revalidatePath('/sales/quotations');
  revalidatePath(`/sales/quotations/${id}`);
  revalidatePath('/sales/invoices');
  return { success: true, invoice };
}

export async function extendQuotationReservationAction(id: string, extraDays: number = 14) {
  const actor = await authorize(PERMISSIONS.QUOTATIONS_MANAGE);
  const result = await extendQuotationReservationExpiry(id, extraDays, actor.id);
  revalidatePath('/sales/quotations');
  revalidatePath(`/sales/quotations/${id}`);
  return result;
}

