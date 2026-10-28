import React from 'react';

export function PaymentStatusBadge({ status }: { status: string }) {
  let color = 'bg-slate-100 text-slate-800 border-slate-300';
  let label = status;

  switch (status) {
    case 'confirmed':
      color = 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800';
      label = 'Confirmed';
      break;
    case 'pending':
      color = 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800';
      label = 'Pending Clearing';
      break;
    case 'failed':
      color = 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800';
      label = 'Failed / Bounced';
      break;
    case 'reversed':
      color = 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800';
      label = 'Reversed';
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}
    >
      {label}
    </span>
  );
}

export function ReconciliationBadge({ status }: { status: string }) {
  let color = 'bg-slate-100 text-slate-600 border-slate-200';
  let label = status;

  switch (status) {
    case 'reconciled':
      color = 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800';
      label = 'Reconciled';
      break;
    case 'unreconciled':
      color = 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800';
      label = 'Unreconciled';
      break;
    case 'not_required':
      color = 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
      label = 'Cash (N/A)';
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${color}`}
    >
      {label}
    </span>
  );
}

export function PaymentMethodBadge({ method }: { method: string }) {
  const methodLabels: Record<string, string> = {
    cash: 'Cash',
    bank_transfer: 'Bank Transfer',
    cheque: 'Cheque',
    card: 'Card Terminal',
    airtel_money: 'Airtel Money',
    mpamba: 'TNM Mpamba',
  };

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
      {methodLabels[method] || method.replace('_', ' ').toUpperCase()}
    </span>
  );
}
