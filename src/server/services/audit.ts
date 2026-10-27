/**
 * Audit log writer.
 *
 * Every create, update, void, adjustment and payment action must call writeAuditLog()
 * inside the same database transaction so the audit entry is atomic with the change.
 *
 * Usage (inside a transaction):
 *   await writeAuditLog(tx, {
 *     userId: actor.id,
 *     action: 'invoice.void',
 *     entityType: 'invoice',
 *     entityId: invoice.id,
 *     before: { status: 'issued' },
 *     after: { status: 'void' },
 *     ip,
 *   });
 */

import type { db as DbType } from '@/server/db';
import { auditLog } from '@/server/db/schema';

export type AuditAction =
  | 'user.create'
  | 'user.update'
  | 'user.deactivate'
  | 'user.reactivate'
  | 'user.password_change'
  | 'role.update'
  | 'setting.update'
  | 'login.success'
  | 'login.failed'
  | 'login.rate_limited';

export interface WriteAuditLogParams {
  userId?: string | null;
  action: string; // AuditAction or any future action string
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
}

/**
 * Writes an entry to the audit_log table.
 * Pass the Drizzle `db` instance or a transaction (they share the same interface).
 */
export async function writeAuditLog(
  database: typeof DbType,
  params: WriteAuditLogParams,
): Promise<void> {
  await database.insert(auditLog).values({
    userId: params.userId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    before: params.before ?? null,
    after: params.after ?? null,
    ip: params.ip ?? null,
  });
}
