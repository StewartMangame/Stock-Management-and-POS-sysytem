'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { createDeliveryNote } from '@/server/services/sales/delivery-notes';
import type { CreateDeliveryNoteInput } from '@/server/services/sales/delivery-notes';

export async function createDeliveryNoteAction(input: CreateDeliveryNoteInput) {
  const actor = await authorize(PERMISSIONS.DELIVERY_NOTES_MANAGE);
  const deliveryNote = await createDeliveryNote(input, actor.id);
  revalidatePath('/sales/delivery-notes');
  revalidatePath(`/sales/delivery-notes/${deliveryNote.id}`);
  revalidatePath('/sales/invoices');
  revalidatePath(`/sales/invoices/${input.salesDocumentId}`);
  return { success: true, deliveryNote };
}
