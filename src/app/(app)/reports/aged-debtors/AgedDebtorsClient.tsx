'use client';

import React from 'react';
import Link from 'next/link';
import { formatTambala } from '@/lib/money';
import { Download, FileSpreadsheet } from 'lucide-react';

export function AgedDebtorsClient({ report }: { report: any }) {
  const handleExportCsv = () => {
    const headers = [
      'Customer',
      'Account Number',
      'Credit Limit (MWK)',
      'Current (MWK)',
      '1-30 Days (MWK)',
      '31-60 Days (MWK)',
      '61-90 Days (MWK)',
      '90+ Days (MWK)',
      'Total Outstanding (MWK)',
      'Customer Credit (MWK)',
      'Net Due (MWK)',
    ];

    const rows = (report.rows || []).map((r: any) => [
      `"${(r.customerName || 'Unknown').replace(/"/g, '""')}"`,
      r.accountNumber || '',
      (Number(r.creditLimitMinor || 0) / 100).toFixed(2),
      (Number(r.currentMinor || 0) / 100).toFixed(2),
      (Number(r.days1_30Minor || 0) / 100).toFixed(2),
      (Number(r.days31_60Minor || 0) / 100).toFixed(2),
      (Number(r.days61_90Minor || 0) / 100).toFixed(2),
      (Number(r.days90plusMinor || 0) / 100).toFixed(2),
      (Number(r.totalOutstandingMinor || 0) / 100).toFixed(2),
      (Number(r.customerCreditMinor || 0) / 100).toFixed(2),
      (Number(r.netDueMinor || 0) / 100).toFixed(2),
    ]);

    rows.push([
      '"GRAND TOTAL"',
      '""',
      '""',
      (report.totals.currentMinor / 100).toFixed(2),
      (report.totals.days1_30Minor / 100).toFixed(2),
      (report.totals.days31_60Minor / 100).toFixed(2),
      (report.totals.days61_90Minor / 100).toFixed(2),
      (report.totals.days90plusMinor / 100).toFixed(2),
      (report.totals.totalOutstandingMinor / 100).toFixed(2),
      (report.totals.customerCreditMinor / 100).toFixed(2),
      (report.totals.netDueMinor / 100).toFixed(2),
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e: any[]) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `aged_debtors_${report.asOf}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500 uppercase">Current (Not Due)</div>
          <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
            {formatTambala(report.totals.currentMinor)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-amber-600 uppercase">1–30 Days Overdue</div>
          <div className="text-xl font-bold text-amber-600 mt-1">
            {formatTambala(report.totals.days1_30Minor)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-rose-600 uppercase">Over 30 Days Overdue</div>
          <div className="text-xl font-bold text-rose-600 mt-1">
            {formatTambala(
              report.totals.days31_60Minor +
                report.totals.days61_90Minor +
                report.totals.days90plusMinor,
            )}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-emerald-600 uppercase">Available Credit</div>
          <div className="text-xl font-bold text-emerald-600 mt-1">
            {formatTambala(report.totals.customerCreditMinor)}
          </div>
        </div>
      </div>

      {/* CSV Export Button & Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Ledger Table (as of {report.asOf})
          </span>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            Download CSV
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/60 font-semibold uppercase text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4 text-right">Current</th>
                <th className="py-3 px-4 text-right">1-30 Days</th>
                <th className="py-3 px-4 text-right">31-60 Days</th>
                <th className="py-3 px-4 text-right">61-90 Days</th>
                <th className="py-3 px-4 text-right">90+ Days</th>
                <th className="py-3 px-4 text-right">Total Outstanding</th>
                <th className="py-3 px-4 text-right">Credit</th>
                <th className="py-3 px-4 text-right">Net Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No outstanding aged balances as of {report.asOf}.
                  </td>
                </tr>
              ) : (
                report.rows.map((row: any) => (
                  <tr key={row.customerId} className="hover:bg-slate-50/50">
                    <td className="py-3 px-4">
                      <Link
                        href={`/sales/customers/${row.customerId}`}
                        className="font-semibold text-slate-900 dark:text-slate-100 hover:underline"
                      >
                        {row.customerName}
                      </Link>
                      <div className="text-xs text-slate-400">{row.accountNumber}</div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono">{formatTambala(row.currentMinor)}</td>
                    <td className="py-3 px-4 text-right font-mono text-amber-700 dark:text-amber-400">
                      {formatTambala(row.days1_30Minor)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-orange-700 dark:text-orange-400">
                      {formatTambala(row.days31_60Minor)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-rose-700 dark:text-rose-400">
                      {formatTambala(row.days61_90Minor)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-red-700 dark:text-red-400 font-bold">
                      {formatTambala(row.days90plusMinor)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                      {formatTambala(row.totalOutstandingMinor)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-700 dark:text-emerald-400">
                      {formatTambala(row.customerCreditMinor)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                      {formatTambala(row.netDueMinor)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {report.rows.length > 0 && (
              <tfoot className="bg-slate-50 dark:bg-slate-800 font-bold border-t-2 border-slate-300 dark:border-slate-700">
                <tr>
                  <td className="py-3 px-4">GRAND TOTALS</td>
                  <td className="py-3 px-4 text-right font-mono">
                    {formatTambala(report.totals.currentMinor)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono">
                    {formatTambala(report.totals.days1_30Minor)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono">
                    {formatTambala(report.totals.days31_60Minor)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono">
                    {formatTambala(report.totals.days61_90Minor)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono">
                    {formatTambala(report.totals.days90plusMinor)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-slate-900 dark:text-slate-100">
                    {formatTambala(report.totals.totalOutstandingMinor)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-emerald-700 dark:text-emerald-400">
                    {formatTambala(report.totals.customerCreditMinor)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-slate-900 dark:text-slate-100">
                    {formatTambala(report.totals.netDueMinor)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
