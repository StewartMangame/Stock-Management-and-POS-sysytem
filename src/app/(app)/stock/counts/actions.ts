'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { createStockCount, reconcileStockCount } from '@/server/services/stock/stock-counts';
import type { StockCountInput } from '@/server/services/stock/stock-counts';

export async function createStockCountAction(data: StockCountInput) {
  const actor = await authorize(PERMISSIONS.STOCK_COUNT);
  const count = await createStockCount(data, actor.id);
  revalidatePath('/stock/counts');
  return { success: true, count };
}

export async function reconcileStockCountAction(
  countId: string,
  items: Array<{ productId: string; countedQty: string | number; missingSerialIds?: string[] }>,
) {
  const actor = await authorize(PERMISSIONS.STOCK_COUNT);
  const result = await reconcileStockCount(countId, items, actor.id);
  revalidatePath('/stock/counts');
  revalidatePath('/stock/on-hand');
  revalidatePath('/stock/movements');
  return { success: true, result };
}
