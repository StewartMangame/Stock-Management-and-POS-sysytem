import React from 'react';
import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getAuditLogEntries } from '@/server/services/audit-log';
import { AuditLogClient } from './AuditLogClient';

export const metadata: Metadata = {
  title: 'Audit Trail',
};

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: 'all' | 'business' | 'security';
    entityType?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const actor = await authorize(PERMISSIONS.AUDIT_LOG_VIEW);
  const isSuperAdmin = (actor.role.permissions as string[]).includes(PERMISSIONS.AUDIT_LOG_VIEW_ALL);

  const params = await searchParams;
  const category = params.category || 'all';
  const entityType = params.entityType || undefined;
  const from = params.from || undefined;
  const to = params.to || undefined;

  // Non-super-admins cannot see security category
  const effectiveCategory = !isSuperAdmin && category === 'security' ? 'business' : category;

  const { entries, totalCount } = await getAuditLogEntries({
    category: effectiveCategory,
    entityType,
    from,
    to,
    limit: 50,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          System Audit Trail
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Immutable event log tracking all state mutations, administrative actions, and security access.
        </p>
      </div>

      <AuditLogClient
        initialEntries={entries}
        totalCount={totalCount}
        canViewSecurity={isSuperAdmin}
        currentCategory={category}
        currentEntityType={entityType ?? ''}
        currentFrom={from ?? ''}
        currentTo={to ?? ''}
      />
    </div>
  );
}

