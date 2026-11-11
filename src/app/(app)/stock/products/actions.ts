'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { createProduct, updateProduct } from '@/server/services/stock/products';
import type { ProductInput } from '@/server/services/stock/products';
import { createUnitOfMeasure, type UomInput } from '@/server/services/stock/uom';

export async function createProductAction(data: ProductInput) {
  const actor = await authorize(PERMISSIONS.PRODUCTS_MANAGE);
  const product = await createProduct(data, actor.id);
  revalidatePath('/stock/products');
  return { success: true, product };
}

export async function updateProductAction(id: string, data: Partial<Omit<ProductInput, 'sku' | 'productType'>>) {
  const actor = await authorize(PERMISSIONS.PRODUCTS_MANAGE);
  const product = await updateProduct(id, data, actor.id);
  revalidatePath('/stock/products');
  revalidatePath(`/stock/products/${id}`);
  return { success: true, product };
}

export async function createUomAction(data: UomInput) {
  await authorize(PERMISSIONS.PRODUCTS_MANAGE);
  const uom = await createUnitOfMeasure(data);
  revalidatePath('/stock/products');
  return { success: true, uom };
}
