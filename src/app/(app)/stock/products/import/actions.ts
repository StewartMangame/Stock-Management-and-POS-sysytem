'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import {
  previewProductsCsv,
  commitProductsCsv,
  previewOpeningStockCsv,
  commitOpeningStockCsv,
} from '@/server/services/stock/csv-import';

export async function previewProductsCsvAction(csvContent: string) {
  await authorize(PERMISSIONS.PRODUCTS_MANAGE);
  return await previewProductsCsv(csvContent);
}

export async function commitProductsCsvAction(csvContent: string) {
  const actor = await authorize(PERMISSIONS.PRODUCTS_MANAGE);
  const result = await commitProductsCsv(csvContent, actor.id);
  revalidatePath('/stock/products');
  return { success: true, result };
}

export async function previewOpeningStockCsvAction(csvContent: string) {
  await authorize(PERMISSIONS.STOCK_ADJUST);
  return await previewOpeningStockCsv(csvContent);
}

export async function commitOpeningStockCsvAction(csvContent: string) {
  const actor = await authorize(PERMISSIONS.STOCK_ADJUST);
  const result = await commitOpeningStockCsv(csvContent, actor.id);
  revalidatePath('/stock/on-hand');
  revalidatePath('/stock/movements');
  revalidatePath('/stock/products');
  revalidatePath('/stock/serials');
  return { success: true, result };
}
