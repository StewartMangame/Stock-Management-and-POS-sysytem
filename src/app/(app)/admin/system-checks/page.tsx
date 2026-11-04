import React from 'react';
import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getSystemChecksHistory } from '@/server/services/system-checks';
import { SystemChecksClient } from './SystemChecksClient';

export const metadata: Metadata = {
  title: 'System Health Checks',
};

export default async function SystemChecksPage() {
  await authorize(PERMISSIONS.SYSTEM_CHECKS_RUN);

  const history = await getSystemChecksHistory(15);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          System Checks & Invariant Controls
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Verify system-wide integrity constraints, reconciliation health, and ledger invariants.
        </p>
      </div>

      <SystemChecksClient initialHistory={history} />
    </div>
  );
}

