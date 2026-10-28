import React from 'react';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getCustomerStatement } from '@/server/services/reports/customer-statement';
import { getCustomers } from '@/server/services/sales/customers';
import { CustomerStatementClient } from './CustomerStatementClient';
import { Download, FileText } from 'lucide-react';

export default async function CustomerStatementPage({
  searchParams,
}: {
  searchParams: Promise<{
    customerId?: string;
    from?: string;
    to?: string;
  }>;
}) {
  await authorize(PERMISSIONS.REPORTS_VIEW);

  const params = await searchParams;
  const customersList = await getCustomers({ isActive: true });

  const selectedCustomerId = params.customerId || customersList[0]?.id || '';
  const to = params.to || new Date().toISOString().slice(0, 10);
  const from =
    params.from ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let statement = null;
  if (selectedCustomerId) {
    try {
      statement = await getCustomerStatement(selectedCustomerId, from, to);
    } catch (err) {
      console.error('Failed to load statement:', err);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Customer Account Statement
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Generate itemized debit & credit running statements with historical opening and closing balances.
          </p>
        </div>

        {selectedCustomerId && statement && (
          <div className="flex items-center gap-2">
            <a
              href={`/api/pdf/statement/${selectedCustomerId}?from=${from}&to=${to}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" />
              Export PDF Statement
            </a>
          </div>
        )}
      </div>

      {/* Filter Form */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
        <form method="GET" className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Select Customer
            </label>
            <select
              name="customerId"
              defaultValue={selectedCustomerId}
              className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5"
            >
              {customersList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.accountNumber})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              From Date
            </label>
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5"
            />
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">
                To Date
              </label>
              <input
                type="date"
                name="to"
                defaultValue={to}
                className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-1.5 text-sm font-medium rounded-lg bg-slate-800 text-white hover:bg-slate-700 transition-colors"
            >
              Generate
            </button>
          </div>
        </form>
      </div>

      {/* Content */}
      {statement ? (
        <CustomerStatementClient statement={statement} />
      ) : (
        <div className="p-12 text-center text-slate-400 border border-dashed rounded-xl">
          Select a customer and date range to view statement.
        </div>
      )}
    </div>
  );
}
