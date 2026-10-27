'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { createSupplier, updateSupplier } from '@/server/services/purchasing/suppliers';
import type { SupplierInput } from '@/server/services/purchasing/suppliers';

export async function createSupplierAction(data: SupplierInput) {
  const actor = await authorize(PERMISSIONS.SUPPLIERS_MANAGE);
  const supplier = await createSupplier(data, actor.id);
  revalidatePath('/purchasing/suppliers');
  return { success: true, supplier };
}

export async function updateSupplierAction(id: string, data: Partial<SupplierInput>) {
  const actor = await authorize(PERMISSIONS.SUPPLIERS_MANAGE);
  const supplier = await updateSupplier(id, data, actor.id);
  revalidatePath('/purchasing/suppliers');
  return { success: true, supplier };
}
