'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  confirmChequeAction,
  bounceChequeAction,
  reversePaymentAction,
  markReconciledAction,
} from '@/app/(app)/sales/payments/actions';
import { formatTambala } from '@/lib/money';
import {
  PaymentStatusBadge,
  ReconciliationBadge,
  PaymentMethodBadge,
} from '@/components/payments/PaymentStatusBadge';
import {
  Download,
  CheckCircle,
  XCircle,
  RotateCcw,
  ShieldCheck,
  Calendar,
  Building,
  User,
  CreditCard,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

export function PaymentDetailClient({
  payment,
}: {
  payment: any;
}) {
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showReverseModal, setShowReverseModal] = useState(false);
  const [reversalReason, setReversalReason] = useState('');

  const [showBounceModal, setShowBounceModal] = useState(false);
  const [bounceReason, setBounceReason] = useState('');

  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [reconcileNote, setReconcileNote] = useState('');

  const isPendingCheque = payment.method === 'cheque' && payment.status === 'pending';
  const isConfirmed = payment.status === 'confirmed';
  const isUnreconciled = payment.reconciliationStatus === 'unreconciled';

  const allocations = payment.allocations || [];
  const totalAllocated = allocations.reduce((sum: number, a: any) => sum + Number(a.amountMinor), 0);
  const unallocatedCredit = Number(payment.amountMinor) - totalAllocated;

  const handleConfirmCheque = async () => {
    if (!confirm('Are you sure you want to clear this cheque? Provisional allocations will be applied.')) {
      return;
    }
    setIsProcessing(true);
    try {
      const res = await confirmChequeAction(payment.id);
      if (res.failedAllocations && res.failedAllocations.length > 0) {
        toast.warning(res.message);
      } else {
        toast.success(res.message);
      }
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear cheque');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBounceCheque = async () => {
    setIsProcessing(true);
    try {
      await bounceChequeAction(payment.id, bounceReason);
      toast.success('Cheque marked as failed / bounced');
      setShowBounceModal(false);
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to bounce cheque');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReversePayment = async () => {
    if (!reversalReason.trim()) {
      toast.error('Please provide a reason for the reversal');
      return;
    }
    setIsProcessing(true);
    try {
      await reversePaymentAction(payment.id, reversalReason);
      toast.success('Payment successfully reversed and ledger balances restored');
      setShowReverseModal(false);
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to reverse payment');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMarkReconciled = async () => {
    setIsProcessing(true);
    try {
      await markReconciledAction(payment.id, reconcileNote);
      toast.success('Payment marked as reconciled');
      setShowReconcileModal(false);
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to reconcile payment');
    } finally {
      setIsProcessing(false);
    }
  };

  const methodDetails = payment.methodDetails || {};

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100">
              {payment.paymentNumber}
            </h1>
            <PaymentStatusBadge status={payment.status} />
            <ReconciliationBadge status={payment.reconciliationStatus} />
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Recorded on {payment.paymentDate} • Idempotency Ref: {payment.idempotencyKey.slice(0, 8)}...
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* PDF Receipt Button */}
          <a
            href={`/api/pdf/receipt/${payment.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
          >
            <Download className="w-4 h-4" />
            PDF Receipt
          </a>

          {/* Pending Cheque Actions */}
          {isPendingCheque && (
            <>
              <button
                type="button"
                onClick={handleConfirmCheque}
                disabled={isProcessing}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors disabled:opacity-50"
              >
                <CheckCircle className="w-4 h-4" />
                Clear Cheque
              </button>
              <button
                type="button"
                onClick={() => setShowBounceModal(true)}
                disabled={isProcessing}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-colors disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                Bounce Cheque
              </button>
            </>
          )}

          {/* Reconcile Action */}
          {isUnreconciled && isConfirmed && (
            <button
              type="button"
              onClick={() => setShowReconcileModal(true)}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition-colors disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              Mark Reconciled
            </button>
          )}

          {/* Reversal Action */}
          {isConfirmed && (
            <button
              type="button"
              onClick={() => setShowReverseModal(true)}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-700 transition-colors disabled:opacity-50 dark:bg-purple-950/30 dark:border-purple-800 dark:text-purple-300"
            >
              <RotateCcw className="w-4 h-4" />
              Reverse Payment
            </button>
          )}
        </div>
      </div>

      {/* Pending Cheque Banner */}
      {isPendingCheque && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <h4 className="font-semibold text-sm">Cheque Pending Clearing</h4>
            <p className="mt-0.5">
              This cheque has not yet been cleared by the bank. Intended invoice allocations will only be deducted and applied once a manager confirms clearance.
            </p>
          </div>
        </div>
      )}

      {/* Reversed Banner */}
      {payment.status === 'reversed' && (
        <div className="bg-purple-50 border border-purple-300 rounded-xl p-4 text-purple-900 dark:bg-purple-950/30 dark:border-purple-800 dark:text-purple-200">
          <div className="flex items-center justify-between text-xs">
            <div>
              <span className="font-bold text-sm">Reversed on {new Date(payment.reversedAt).toLocaleString()}</span>
              {payment.reversalReason && (
                <p className="mt-1">Reason: {payment.reversalReason}</p>
              )}
            </div>
            <span className="font-mono text-xs uppercase px-2 py-1 bg-purple-200 dark:bg-purple-900 rounded font-semibold">
              Reversal Settled
            </span>
          </div>
        </div>
      )}

      {/* Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Customer Information */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <User className="w-4 h-4 text-slate-400" />
            Customer
          </h3>
          <div>
            <Link
              href={`/sales/customers/${payment.customer?.id}`}
              className="text-base font-bold text-slate-900 dark:text-slate-100 hover:underline"
            >
              {payment.customer?.name}
            </Link>
            <div className="text-xs text-slate-500 mt-0.5">
              Account: {payment.customer?.accountNumber}
            </div>
            {payment.customer?.taxNumber && (
              <div className="text-xs text-slate-500">TPIN: {payment.customer.taxNumber}</div>
            )}
            {payment.customer?.phone && (
              <div className="text-xs text-slate-500">Phone: {payment.customer.phone}</div>
            )}
          </div>
        </div>

        {/* Method Information */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <CreditCard className="w-4 h-4 text-slate-400" />
            Payment Method
          </h3>
          <div className="space-y-1 text-xs">
            <div className="mb-2">
              <PaymentMethodBadge method={payment.method} />
            </div>

            {payment.method === 'cheque' && (
              <>
                <p><span className="text-slate-500">Cheque No:</span> {methodDetails.cheque_number}</p>
                <p><span className="text-slate-500">Bank:</span> {methodDetails.bank}</p>
                <p><span className="text-slate-500">Cheque Date:</span> {methodDetails.cheque_date}</p>
              </>
            )}
            {payment.method === 'bank_transfer' && (
              <>
                <p><span className="text-slate-500">Bank Ref:</span> {methodDetails.bank_reference}</p>
                {methodDetails.bank_name && (
                  <p><span className="text-slate-500">Bank:</span> {methodDetails.bank_name}</p>
                )}
              </>
            )}
            {payment.method === 'card' && (
              <>
                <p><span className="text-slate-500">Terminal ID:</span> {methodDetails.terminal_id}</p>
                <p><span className="text-slate-500">Approval Code:</span> {methodDetails.approval_code}</p>
                <p><span className="text-slate-500">Slip Number:</span> {methodDetails.slip_number}</p>
              </>
            )}
            {(payment.method === 'airtel_money' || payment.method === 'mpamba') && (
              <>
                <p><span className="text-slate-500">Txn ID:</span> {methodDetails.transaction_id}</p>
                <p><span className="text-slate-500">Sender:</span> {methodDetails.sender_phone}</p>
              </>
            )}
          </div>
        </div>

        {/* Amount & Accounting */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Accounting Summary
          </h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Total Amount:</span>
              <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                {formatTambala(payment.amountMinor)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Allocated to Invoices:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {formatTambala(totalAllocated)}
              </span>
            </div>
            <div className="flex justify-between items-center border-t border-slate-100 dark:border-slate-800 pt-2">
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">Customer Credit:</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400">
                {formatTambala(Math.max(0, unallocatedCredit))}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Allocations Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <FileText className="w-5 h-5 text-emerald-600" />
          Allocations Breakdown
        </h3>

        {allocations.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
            No invoice allocations recorded for this payment. The full amount is credited to customer account.
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-semibold uppercase">
                <tr>
                  <th className="py-2.5 px-3">Invoice #</th>
                  <th className="py-2.5 px-3">Allocated Date</th>
                  <th className="py-2.5 px-3">Notes</th>
                  <th className="py-2.5 px-3 text-right">Amount (MWK)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {allocations.map((a: any) => (
                  <tr key={a.id} className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 font-mono font-medium text-blue-600 hover:underline">
                      <Link href={`/sales/invoices/${a.invoiceId}`}>
                        {a.documentNumber || a.invoiceId.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="py-2.5 px-3 text-slate-500">
                      {new Date(a.allocatedAt).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500">{a.notes || '—'}</td>
                    <td className={`py-2.5 px-3 text-right font-semibold ${
                      Number(a.amountMinor) < 0 ? 'text-rose-600' : 'text-slate-900 dark:text-slate-100'
                    }`}>
                      {formatTambala(a.amountMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reverse Modal */}
      {showReverseModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl p-6 max-w-md w-full shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-purple-600" />
              Reverse Payment
            </h3>
            <p className="text-xs text-slate-500">
              Reversing this payment will write negative allocation rows, restore open invoice balances, and decrease the customer&apos;s available credit. It will be blocked if customer credit would become negative.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Reason for Reversal <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={3}
                required
                placeholder="State the reason for reversing this payment..."
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 p-2"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowReverseModal(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReversePayment}
                disabled={isProcessing}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-purple-600 hover:bg-purple-500 text-white"
              >
                {isProcessing ? 'Reversing...' : 'Confirm Reversal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bounce Cheque Modal */}
      {showBounceModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl p-6 max-w-md w-full shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 text-rose-600">
              <XCircle className="w-5 h-5" />
              Bounce / Fail Cheque
            </h3>
            <p className="text-xs text-slate-500">
              Mark this cheque as bounced. No invoice balances will be modified since the cheque was never cleared.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Reason / Bank Remark
              </label>
              <input
                type="text"
                placeholder="e.g. Insufficient funds / signature mismatch"
                value={bounceReason}
                onChange={(e) => setBounceReason(e.target.value)}
                className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 p-2"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowBounceModal(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBounceCheque}
                disabled={isProcessing}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white"
              >
                {isProcessing ? 'Processing...' : 'Mark as Bounced'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reconcile Modal */}
      {showReconcileModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl p-6 max-w-md w-full shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 text-blue-600">
              <ShieldCheck className="w-5 h-5" />
              Mark Payment Reconciled
            </h3>
            <p className="text-xs text-slate-500">
              Verify that this bank transfer, card settlement, or mobile money transaction appeared on the bank statement.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Reconciliation Note / Bank Statement Reference
              </label>
              <input
                type="text"
                placeholder="e.g. Verified against Standard Bank statement 15-May"
                value={reconcileNote}
                onChange={(e) => setReconcileNote(e.target.value)}
                className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 p-2"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowReconcileModal(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleMarkReconciled}
                disabled={isProcessing}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white"
              >
                {isProcessing ? 'Saving...' : 'Mark Reconciled'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
