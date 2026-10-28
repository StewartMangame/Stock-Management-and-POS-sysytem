'use server';

import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import {
  createCardTerminal,
  updateCardTerminal,
} from '@/server/services/setup/card-terminals';
import { revalidatePath } from 'next/cache';

export async function createCardTerminalAction(data: {
  name: string;
  terminalId: string;
  locationId: string;
  isActive?: boolean;
}) {
  const actor = await authorize(PERMISSIONS.SETTINGS_MANAGE);
  const result = await createCardTerminal(data, actor.id);
  revalidatePath('/admin/card-terminals');
  return result;
}

export async function updateCardTerminalAction(
  id: string,
  data: {
    name?: string;
    terminalId?: string;
    locationId?: string;
    isActive?: boolean;
  },
) {
  const actor = await authorize(PERMISSIONS.SETTINGS_MANAGE);
  const result = await updateCardTerminal(id, data, actor.id);
  revalidatePath('/admin/card-terminals');
  return result;
}
