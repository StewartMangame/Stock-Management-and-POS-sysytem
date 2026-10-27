'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import {
  createPurchaseOrder,
  submitPurchaseOrder,
  cancelPurchaseOrder,
} from '@/server/services/purchasing/purchase-orders';
import type { PurchaseOrderInput } from '@/server/services/purchasing/purchase-orders';

export async function createPurchaseOrderAction(data: PurchaseOrderInput) {
  const actor = await authorize(PERMISSIONS.PURCHASE_ORDERS_MANAGE);
  const po = await createPurchaseOrder(data, actor.id);
  revalidatePath('/purchasing/orders');
  return { success: true, po };
}

export async function submitPurchaseOrderAction(id: string) {
  const actor = await authorize(PERMISSIONS.PURCHASE_ORDERS_MANAGE);
  const po = await submitPurchaseOrder(id, actor.id);
  revalidatePath('/purchasing/orders');
  revalidatePath(`/purchasing/orders/${id}`);
  return { success: true, po };
}

export async function cancelPurchaseOrderAction(id: string, reason?: string) {
  const actor = await authorize(PERMISSIONS.PURCHASE_ORDERS_MANAGE);
  const po = await cancelPurchaseOrder(id, reason, actor.id);
  revalidatePath('/purchasing/orders');
  revalidatePath(`/purchasing/orders/${id}`);
  return { success: true, po };
}
