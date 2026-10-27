'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import {
  createUnitOfMeasure,
  updateUnitOfMeasure,
  UomInput,
} from '@/server/services/stock/uom';

export async function createUomAction(data: UomInput) {
  await authorize(PERMISSIONS.PRODUCTS_MANAGE);
  const uom = await createUnitOfMeasure(data);
  revalidatePath('/stock/units');
  revalidatePath('/stock/products');
  return { success: true, uom };
}

export async function updateUomAction(id: string, data: Partial<UomInput>) {
  await authorize(PERMISSIONS.PRODUCTS_MANAGE);
  const uom = await updateUnitOfMeasure(id, data);
  revalidatePath('/stock/units');
  revalidatePath('/stock/products');
  return { success: true, uom };
}
