import React from 'react';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getUnreconciledPayments } from '@/server/services/sales/payments';
import { formatTambala } from '@/lib/money';
import {
  PaymentStatusBadge,
  PaymentMethodBadge,
} from '@/components/payments/PaymentStatusBadge';
import { ChevronLeft, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { UnreconciledTable } from './UnreconciledTable';

export default async function UnreconciledPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string }>;
}) {
  await authorize(PERMISSIONS.PAYMENTS_RECONCILE);

  const params = await searchParams;
  const list = await getUnreconciledPayments(params.locationId);

  const totalUnreconciledMinor = list.reduce(
    (sum, item) => sum + Number(item.payment.amountMinor),
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/sales/payments"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <ChevronLeft className="w-5 h-5" />
          Back to Payments
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Unreconciled Payments
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Review external payments (bank transfer, card, mobile money) pending bank statement verification.
          </p>
        </div>
      </div>

      {/* Summary Banner */}
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wider">
            Total Unreconciled Value
          </span>
          <div className="text-2xl font-bold text-amber-900 dark:text-amber-200 mt-0.5">
            {formatTambala(totalUnreconciledMinor)}
          </div>
        </div>
        <div className="text-xs text-amber-700 dark:text-amber-400">
          Showing {list.length} transactions requiring bank statement match
        </div>
      </div>

      {/* Table */}
      <UnreconciledTable initialList={list} />
    </div>
  );
}
