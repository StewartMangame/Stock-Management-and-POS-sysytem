'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { createStockAdjustment } from '@/server/services/stock/stock-adjustments';
import type { StockAdjustmentInput } from '@/server/services/stock/stock-adjustments';

export async function createStockAdjustmentAction(data: StockAdjustmentInput) {
  const actor = await authorize(PERMISSIONS.STOCK_ADJUST);
  const adjustment = await createStockAdjustment(data, actor.id);
  revalidatePath('/stock/adjustments');
  revalidatePath('/stock/on-hand');
  revalidatePath('/stock/movements');
  return { success: true, adjustment };
}
