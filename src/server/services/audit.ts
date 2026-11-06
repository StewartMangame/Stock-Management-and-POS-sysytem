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

// Keys whose values should be redacted (case-insensitive pattern)
const SECRET_KEY_PATTERN = /password|pin|secret|token|key|hash|signature|credential|bearer/i;

/**
 * Recursively redacts values at keys matching SECRET_KEY_PATTERN.
 * Operates on plain objects, arrays, and primitives.
 * Returns a new deeply-cloned structure — does NOT mutate the input.
 */
export function scrubSecrets(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? '[REDACTED]' : scrubSecrets(v);
    }
    return out;
  }
  return value;
}

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
  const scrubbedBefore = params.before ? (scrubSecrets(params.before) as Record<string, unknown>) : null;
  const scrubbedAfter = params.after ? (scrubSecrets(params.after) as Record<string, unknown>) : null;

  await database.insert(auditLog).values({
    userId: params.userId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    before: scrubbedBefore,
    after: scrubbedAfter,
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
