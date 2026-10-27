'use server';

import { auth } from '@/auth';
import { changePassword } from '@/server/services/users';
import { changePasswordSchema } from '@/lib/validation';
import { headers } from 'next/headers';

export type ChangePasswordState = {
  error?: string;
  success?: boolean;
};

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: 'Not authenticated.' };
  }

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? 'Invalid input.';
    return { error: firstError };
  }

  const headersList = await headers();
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  try {
    await changePassword(
      session.user.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      session.user.id,
      ip,
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to change password.';
    return { error: msg };
  }
}
