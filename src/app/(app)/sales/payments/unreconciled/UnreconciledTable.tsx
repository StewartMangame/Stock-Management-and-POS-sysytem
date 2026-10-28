'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { markReconciledAction } from '@/app/(app)/sales/payments/actions';
import { formatTambala } from '@/lib/money';
import { PaymentMethodBadge, PaymentStatusBadge } from '@/components/payments/PaymentStatusBadge';
import { ShieldCheck, ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';

export function UnreconciledTable({ initialList }: { initialList: any[] }) {
  const router = useRouter();
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleReconcile = async (paymentId: string) => {
    const note = prompt('Optional reconciliation note / bank statement reference:');
    if (note === null) return; // User cancelled prompt

    setProcessingId(paymentId);
    try {
      await markReconciledAction(paymentId, note || undefined);
      toast.success('Payment marked as reconciled');
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to reconcile payment');
    } finally {
      setProcessingId(null);
    }
  };

  if (initialList.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center text-slate-400">
        All transactions are fully reconciled! No pending payments require verification.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs uppercase font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-3 px-4">Payment #</th>
              <th className="py-3 px-4">Date</th>
              <th className="py-3 px-4">Customer</th>
              <th className="py-3 px-4">Method</th>
              <th className="py-3 px-4">Reference Details</th>
              <th className="py-3 px-4 text-right">Amount</th>
              <th className="py-3 px-4 text-center">Status</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {initialList.map(({ payment, customerName, customerAccount }) => {
              const details = payment.methodDetails || {};
              let refText = '—';
              if (payment.method === 'bank_transfer') {
                refText = `Bank Ref: ${details.bank_reference || '—'}`;
              } else if (payment.method === 'card') {
                refText = `Slip: ${details.slip_number || '—'} / Appr: ${details.approval_code || '—'}`;
              } else if (payment.method === 'airtel_money' || payment.method === 'mpamba') {
                refText = `Txn: ${details.transaction_id || '—'}`;
              }

              return (
                <tr key={payment.id} className="hover:bg-slate-50/50">
                  <td className="py-3 px-4 font-mono font-medium text-blue-600">
                    <Link href={`/sales/payments/${payment.id}`} className="hover:underline">
                      {payment.paymentNumber}
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-slate-500">{payment.paymentDate}</td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {customerName}
                    </div>
                    <div className="text-xs text-slate-400">{customerAccount}</div>
                  </td>
                  <td className="py-3 px-4">
                    <PaymentMethodBadge method={payment.method} />
                  </td>
                  <td className="py-3 px-4 text-xs font-mono text-slate-500">{refText}</td>
                  <td className="py-3 px-4 text-right font-semibold text-slate-900 dark:text-slate-100">
                    {formatTambala(payment.amountMinor)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <PaymentStatusBadge status={payment.status} />
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      disabled={processingId === payment.id}
                      onClick={() => handleReconcile(payment.id)}
                      className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition-colors disabled:opacity-50"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Reconcile
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
