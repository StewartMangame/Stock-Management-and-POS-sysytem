'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from '@/server/services/sales/customers';

export interface CustomerFormData {
  name: string;
  customerType: 'individual' | 'business';
  email?: string;
  phone?: string;
  address?: string;
  taxNumber?: string;
  creditLimitMinor: number;
  paymentTermsDays: number;
}

export async function createCustomerAction(data: CustomerFormData) {
  const actor = await authorize(PERMISSIONS.CUSTOMERS_MANAGE);
  const customer = await createCustomer(data, actor.id);
  revalidatePath('/sales/customers');
  return { success: true, customer };
}

export async function updateCustomerAction(id: string, data: Partial<CustomerFormData> & { isActive?: boolean }) {
  const actor = await authorize(PERMISSIONS.CUSTOMERS_MANAGE);
  const customer = await updateCustomer(id, data, actor.id);
  revalidatePath('/sales/customers');
  revalidatePath(`/sales/customers/${id}`);
  return { success: true, customer };
}

export async function deleteCustomerAction(id: string) {
  const actor = await authorize(PERMISSIONS.CUSTOMERS_MANAGE);
  await deleteCustomer(id, actor.id);
  revalidatePath('/sales/customers');
  return { success: true };
}
