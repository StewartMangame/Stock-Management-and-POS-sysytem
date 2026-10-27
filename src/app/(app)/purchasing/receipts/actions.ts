'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { createGoodsReceipt, validateGoodsReceipt } from '@/server/services/purchasing/goods-receipts';
import type { GoodsReceiptInput } from '@/server/services/purchasing/goods-receipts';

export async function createGoodsReceiptAction(data: GoodsReceiptInput) {
  const actor = await authorize(PERMISSIONS.GOODS_RECEIPTS_MANAGE);
  const grn = await createGoodsReceipt(data, actor.id);
  revalidatePath('/purchasing/receipts');
  revalidatePath('/purchasing/orders');
  revalidatePath('/stock/on-hand');
  revalidatePath('/stock/movements');
  revalidatePath('/stock/serials');
  return { success: true, grn };
}

export async function validateGoodsReceiptAction(data: GoodsReceiptInput) {
  await authorize(PERMISSIONS.GOODS_RECEIPTS_MANAGE);
  return await validateGoodsReceipt(data);
}
