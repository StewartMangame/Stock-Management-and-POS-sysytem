/**
 * Settings service — read and write application settings.
 *
 * Settings are stored as JSONB key/value pairs.
 * Only keys in SETTING_KEYS are allowed (validated by Zod in the server action).
 */

import { db } from '@/server/db';
import { settings } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { writeAuditLog } from './audit';
import type { SettingKey } from '@/server/db/schema';

export type SettingsMap = Record<SettingKey, unknown>;

/** Load all settings as a key/value map. */
export async function getAllSettings(): Promise<Partial<SettingsMap>> {
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<SettingsMap>;
}

/** Read a single setting value. Returns undefined if not set. */
export async function getSetting(key: SettingKey): Promise<unknown> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  return row?.value;
}

/** Update a single setting. Audits the change. */
export async function updateSetting(
  key: SettingKey,
  value: unknown,
  actorId: string,
  ip?: string,
): Promise<void> {
  const existing = await db.query.settings.findFirst({ where: eq(settings.key, key) });

  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date(), updatedBy: actorId })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date(), updatedBy: actorId },
    });

  await writeAuditLog(db, {
    userId: actorId,
    action: 'setting.update',
    entityType: 'setting',
    before: existing ? { [key]: existing.value } : null,
    after: { [key]: value },
    ip,
  });
}
