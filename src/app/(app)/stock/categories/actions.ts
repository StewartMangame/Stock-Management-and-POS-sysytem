'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import {
  createCategory,
  updateCategory,
  CategoryInput,
} from '@/server/services/stock/categories';

export async function createCategoryAction(data: CategoryInput) {
  const actor = await authorize(PERMISSIONS.PRODUCTS_MANAGE);
  const cat = await createCategory(data, actor.id);
  revalidatePath('/stock/categories');
  revalidatePath('/stock/products');
  return { success: true, cat };
}

export async function updateCategoryAction(id: string, data: Partial<CategoryInput>) {
  const actor = await authorize(PERMISSIONS.PRODUCTS_MANAGE);
  const cat = await updateCategory(id, data, actor.id);
  revalidatePath('/stock/categories');
  revalidatePath('/stock/products');
  return { success: true, cat };
}
