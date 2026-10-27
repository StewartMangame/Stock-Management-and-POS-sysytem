'use server';

import { authorize } from '@/server/auth/authorize';
import { updateSetting } from '@/server/services/settings';
import { updateSettingSchema } from '@/lib/validation';
import { PERMISSIONS } from '@/lib/permissions';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

export type SettingActionState = { error?: string; success?: boolean; key?: string };

export async function updateSettingAction(
  _prev: SettingActionState,
  formData: FormData,
): Promise<SettingActionState> {
  try {
    const actor = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

    const raw = {
      key: formData.get('key'),
      value: formData.get('value'),
    };

    const parsed = updateSettingSchema.safeParse(raw);
    if (!parsed.success) {
      return { error: parsed.error.errors[0]?.message ?? 'Invalid input.' };
    }

    // Coerce value type based on expected types
    let value: unknown = parsed.data.value;
    const boolKeys = ['allow_negative_stock', 'prices_include_tax', 'eis_enabled'];
    const numberKeys = ['max_discount_percent_without_approval', 'quotation_valid_days'];

    if (boolKeys.includes(parsed.data.key)) {
      value = parsed.data.value === 'true' || parsed.data.value === true;
    } else if (numberKeys.includes(parsed.data.key)) {
      value = Number(parsed.data.value);
    }

    await updateSetting(parsed.data.key, value, actor.id, ip);
    revalidatePath('/admin/settings');
    return { success: true, key: parsed.data.key };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update setting.' };
  }
}
