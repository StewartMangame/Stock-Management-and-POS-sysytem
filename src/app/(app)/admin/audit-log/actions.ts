'use server';

import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getAuditLogEntries, getEntityAuditHistory, type AuditLogFilter } from '@/server/services/audit-log';

export async function fetchAuditLogsAction(filters: AuditLogFilter) {
  const actor = await authorize(PERMISSIONS.AUDIT_LOG_VIEW);
  const isSuperAdmin = (actor.role.permissions as string[]).includes(PERMISSIONS.AUDIT_LOG_VIEW_ALL);

  // If not super-admin, restrict category to business only if requesting security logs
  if (!isSuperAdmin && filters.category === 'security') {
    throw new Error('Access denied: Security events audit requires audit_log:view_all permission.');
  }

  return getAuditLogEntries(filters);
}

export async function fetchEntityAuditHistoryAction(entityType: string, entityId: string) {
  await authorize(PERMISSIONS.AUDIT_LOG_VIEW);
  return getEntityAuditHistory(entityType, entityId);
}

