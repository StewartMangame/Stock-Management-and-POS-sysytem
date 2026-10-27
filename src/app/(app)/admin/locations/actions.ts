'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { createLocation, updateLocation } from '@/server/services/stock/locations';
import type { LocationInput } from '@/server/services/stock/locations';

export async function createLocationAction(data: LocationInput) {
  const actor = await authorize(PERMISSIONS.LOCATIONS_MANAGE);
  const location = await createLocation(data, actor.id);
  revalidatePath('/admin/locations');
  return { success: true, location };
}

export async function updateLocationAction(id: string, data: Partial<LocationInput>) {
  const actor = await authorize(PERMISSIONS.LOCATIONS_MANAGE);
  const location = await updateLocation(id, data, actor.id);
  revalidatePath('/admin/locations');
  return { success: true, location };
}
