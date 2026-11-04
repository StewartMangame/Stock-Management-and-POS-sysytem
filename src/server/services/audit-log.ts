/**
 * Audit Log Service (Phase 6, Milestone 5).
 *
 * Provides querying and filtering of the immutable audit_log table:
 *   - Category filtering (business events vs security events)
 *   - Entity type and entity ID filtering for entity history tabs
 *   - Date range filtering
 *   - Keyset/page pagination
 */

import { db } from '@/server/db';
import { sql } from 'drizzle-orm';
import { auditLog } from '@/server/db/schema';
import { desc, eq, and } from 'drizzle-orm';

export interface AuditLogFilter {
  category?: 'all' | 'business' | 'security';
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogEntry {
  id: string;
  at: string;
  action: string;
  category: 'business' | 'security';
  entityType: string;
  entityId: string | null;
  userName: string | null;
  userEmail: string | null;
  userRole: string | null;
  ip: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const SECURITY_ACTIONS = new Set([
  'auth.login',
  'auth.logout',
  'auth.failed_login',
  'auth.password_reset',
  'auth.password_change',
  'user.created',
  'user.updated',
  'user.deactivated',
  'role.permission_changed',
  'settings.updated',
  'audit_log.export',
]);

export async function getAuditLogEntries(filters: AuditLogFilter): Promise<{
  entries: AuditLogEntry[];
  totalCount: number;
}> {
  const limit = Math.min(filters.limit || 50, 100);
  const offset = filters.offset || 0;

  const conditions = [];

  if (filters.entityType) {
    conditions.push(sql`al.entity_type = ${filters.entityType}`);
  }
  if (filters.entityId) {
    conditions.push(sql`al.entity_id = ${filters.entityId}::uuid`);
  }
  if (filters.userId) {
    conditions.push(sql`al.user_id = ${filters.userId}::uuid`);
  }
  if (filters.from) {
    conditions.push(sql`al.at >= ${filters.from}::timestamptz`);
  }
  if (filters.to) {
    // End of day
    conditions.push(sql`al.at <= (${filters.to}::date + INTERVAL '1 day')`);
  }

  if (filters.category === 'security') {
    conditions.push(sql`al.action IN ('auth.login', 'auth.logout', 'auth.failed_login', 'auth.password_change', 'user.created', 'user.updated', 'user.deactivated', 'settings.updated')`);
  } else if (filters.category === 'business') {
    conditions.push(sql`al.action NOT IN ('auth.login', 'auth.logout', 'auth.failed_login', 'auth.password_change', 'user.created', 'user.updated', 'user.deactivated', 'settings.updated')`);
  }

  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``;

  const [countRes, rowsRes] = await Promise.all([
    db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM audit_log al
      ${whereClause}
    `),
    db.execute<{
      id: string;
      at: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      ip: string | null;
      before: any;
      after: any;
      user_name: string | null;
      user_email: string | null;
      user_role: string | null;
    }>(sql`
      SELECT
        al.id,
        al.at::text,
        al.action,
        al.entity_type,
        al.entity_id::text,
        al.ip::text,
        al.before,
        al.after,
        u.name AS user_name,
        u.email AS user_email,
        r.name AS user_role
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.user_id
      LEFT JOIN roles r ON r.id = u.role_id
      ${whereClause}
      ORDER BY al.at DESC, al.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
  ]);

  const totalCount = Number(countRes.rows[0]?.count || 0);

  const entries: AuditLogEntry[] = rowsRes.rows.map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    category: SECURITY_ACTIONS.has(r.action) ? 'security' : 'business',
    entityType: r.entity_type,
    entityId: r.entity_id,
    userName: r.user_name,
    userEmail: r.user_email,
    userRole: r.user_role,
    ip: r.ip,
    before: r.before,
    after: r.after,
  }));

  return { entries, totalCount };
}

export async function getEntityAuditHistory(
  entityType: string,
  entityId: string,
  limit = 30,
): Promise<AuditLogEntry[]> {
  const result = await getAuditLogEntries({
    entityType,
    entityId,
    limit,
  });
  return result.entries;
}

