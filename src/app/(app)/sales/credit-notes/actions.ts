'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { createCreditNote } from '@/server/services/sales/credit-notes';
import type { CreateCreditNoteInput } from '@/server/services/sales/credit-notes';

export async function createCreditNoteAction(input: CreateCreditNoteInput) {
  const actor = await authorize(PERMISSIONS.CREDIT_NOTES_MANAGE);
  const creditNote = await createCreditNote(input, actor.id);
  revalidatePath('/sales/credit-notes');
  revalidatePath(`/sales/credit-notes/${creditNote.id}`);
  revalidatePath('/sales/invoices');
  revalidatePath(`/sales/invoices/${input.invoiceId}`);
  return { success: true, creditNote };
}
