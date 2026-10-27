'use server';

import { authorize } from '@/server/auth/authorize';
import { createUser, updateUser, setUserActive } from '@/server/services/users';
import { createUserSchema, updateUserSchema } from '@/lib/validation';
import { PERMISSIONS } from '@/lib/permissions';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

function getIp(): Promise<string> {
  return headers().then((h) => h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown');
}

export type UserActionState = { error?: string; success?: boolean };

export async function createUserAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  try {
    const actor = await authorize(PERMISSIONS.USERS_MANAGE);
    const ip = await getIp();

    const parsed = createUserSchema.safeParse({
      name: formData.get('name'),
      email: formData.get('email'),
      password: formData.get('password'),
      roleId: formData.get('roleId'),
      defaultLocationId: formData.get('defaultLocationId') || null,
    });

    if (!parsed.success) {
      return { error: parsed.error.errors[0]?.message ?? 'Invalid input.' };
    }

    await createUser(parsed.data, actor.id, ip);
    revalidatePath('/admin/users');
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to create user.' };
  }
}

export async function updateUserAction(
  userId: string,
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  try {
    const actor = await authorize(PERMISSIONS.USERS_MANAGE);
    const ip = await getIp();

    const parsed = updateUserSchema.safeParse({
      name: formData.get('name'),
      roleId: formData.get('roleId'),
      defaultLocationId: formData.get('defaultLocationId') || null,
    });

    if (!parsed.success) {
      return { error: parsed.error.errors[0]?.message ?? 'Invalid input.' };
    }

    await updateUser(userId, parsed.data, actor.id, ip);
    revalidatePath('/admin/users');
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update user.' };
  }
}

export async function toggleUserActiveAction(
  userId: string,
  isActive: boolean,
): Promise<UserActionState> {
  try {
    const actor = await authorize(PERMISSIONS.USERS_MANAGE);
    const ip = await getIp();
    await setUserActive(userId, isActive, actor.id, ip);
    revalidatePath('/admin/users');
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update user.' };
  }
}
