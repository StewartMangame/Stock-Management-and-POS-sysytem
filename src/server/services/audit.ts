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
 *
 * Or use logAuditEvent() for post-commit logging (no TX required):
 *   await logAuditEvent({ userId, action: 'customer_created', entityType: 'customer', entityId: id });
 */

import { db } from '@/server/db';
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

/** Minimal shared interface between db and transactions — only `insert` is needed. */
type AuditDatabase = Pick<typeof db, 'insert'>;

/**
 * Writes an entry to the audit_log table inside the provided Drizzle database/transaction.
 * Accepts either the top-level `db` instance or a transaction (`tx`) — both expose `insert`.
 */
export async function writeAuditLog(
  database: AuditDatabase,
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

/**
 * Convenience wrapper — logs using the module-level `db` instance (no TX).
 * Use for post-commit audit entries where atomicity with the TX is not required.
 */
export async function logAuditEvent(params: WriteAuditLogParams): Promise<void> {
  await writeAuditLog(db, params);
}
