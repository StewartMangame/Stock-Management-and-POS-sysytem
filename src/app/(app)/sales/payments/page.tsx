import React from 'react';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { listPayments } from '@/server/services/sales/payments';
import { formatTambala } from '@/lib/money';
import {
  PaymentStatusBadge,
  ReconciliationBadge,
  PaymentMethodBadge,
} from '@/components/payments/PaymentStatusBadge';
import { Plus, Filter, FileText, AlertCircle, ArrowUpRight } from 'lucide-react';
import { getLocations } from '@/server/services/locations';

export default async function PaymentsListPage({
  searchParams,
}: {
  searchParams: Promise<{
    method?: string;
    status?: string;
    reconciliationStatus?: string;
    locationId?: string;
    fromDate?: string;
    toDate?: string;
  }>;
}) {
  await authorize(PERMISSIONS.PAYMENTS_VIEW);

  const params = await searchParams;
  const paymentsList = await listPayments({
    method: params.method as any,
    status: params.status,
    reconciliationStatus: params.reconciliationStatus,
    locationId: params.locationId,
    fromDate: params.fromDate,
    toDate: params.toDate,
  });

  const locations = await getLocations();

  const totalReceiptsMinor = paymentsList
    .filter((p) => p.payment.kind === 'receipt' && p.payment.status === 'confirmed')
    .reduce((sum, p) => sum + Number(p.payment.amountMinor), 0);

  const unreconciledCount = paymentsList.filter(
    (p) => p.payment.reconciliationStatus === 'unreconciled',
  ).length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Payments & Accounts Receivable
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Record customer receipts, manage cheque clearings, reconcile accounts, and track allocations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/sales/payments/unreconciled"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300"
          >
            <AlertCircle className="w-4 h-4 text-amber-600" />
            Unreconciled ({unreconciledCount})
          </Link>
          <Link
            href="/sales/payments/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Record Payment
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Total Confirmed Receipts (Filtered)
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
            {formatTambala(totalReceiptsMinor)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Total Transactions
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
            {paymentsList.length}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-amber-600 uppercase tracking-wider">
            Unreconciled Payments
          </div>
          <div className="mt-1 text-2xl font-bold text-amber-600">
            {unreconciledCount}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
        <form method="GET" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Method</label>
            <select
              name="method"
              defaultValue={params.method || ''}
              className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5"
            >
              <option value="">All Methods</option>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cheque">Cheque</option>
              <option value="card">Card Terminal</option>
              <option value="airtel_money">Airtel Money</option>
              <option value="mpamba">TNM Mpamba</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
            <select
              name="status"
              defaultValue={params.status || ''}
              className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5"
            >
              <option value="">All Statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending Clearing</option>
              <option value="failed">Failed / Bounced</option>
              <option value="reversed">Reversed</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Reconciliation</label>
            <select
              name="reconciliationStatus"
              defaultValue={params.reconciliationStatus || ''}
              className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5"
            >
              <option value="">All</option>
              <option value="unreconciled">Unreconciled</option>
              <option value="reconciled">Reconciled</option>
              <option value="not_required">Not Required (Cash)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">From Date</label>
            <input
              type="date"
              name="fromDate"
              defaultValue={params.fromDate || ''}
              className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5"
            />
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">To Date</label>
              <input
                type="date"
                name="toDate"
                defaultValue={params.toDate || ''}
                className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5"
              />
            </div>
            <button
              type="submit"
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-slate-800 text-white hover:bg-slate-700 transition-colors"
            >
              Filter
            </button>
          </div>
        </form>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs uppercase font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Payment #</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Method</th>
                <th className="py-3 px-4">Kind</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Reconciliation</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paymentsList.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No payments found matching the selected criteria.
                  </td>
                </tr>
              ) : (
                paymentsList.map(({ payment, customerName, customerAccount }) => (
                  <tr
                    key={payment.id}
                    className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-medium text-slate-900 dark:text-slate-100">
                      <Link
                        href={`/sales/payments/${payment.id}`}
                        className="hover:underline text-blue-600 dark:text-blue-400"
                      >
                        {payment.paymentNumber}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-slate-500">{payment.paymentDate}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-800 dark:text-slate-200">
                        {customerName}
                      </div>
                      <div className="text-xs text-slate-400">{customerAccount}</div>
                    </td>
                    <td className="py-3 px-4">
                      <PaymentMethodBadge method={payment.method} />
                    </td>
                    <td className="py-3 px-4 capitalize">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded ${
                          payment.kind === 'refund'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {payment.kind}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-slate-900 dark:text-slate-100">
                      {payment.kind === 'refund' ? '-' : ''}
                      {formatTambala(payment.amountMinor)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <PaymentStatusBadge status={payment.status} />
                    </td>
                    <td className="py-3 px-4 text-center">
                      <ReconciliationBadge status={payment.reconciliationStatus} />
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        href={`/sales/payments/${payment.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-500"
                      >
                        View <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
