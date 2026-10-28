'use client';

import React from 'react';
import { formatTambala } from '@/lib/money';
import { FileSpreadsheet } from 'lucide-react';

export function PaymentsReceivedClient({ report }: { report: any }) {
  const methodKeys = Object.keys(report.methodTotals);

  const handleExportCsv = () => {
    const headers = ['Date', ...methodKeys.map((m) => `${m.replace('_', ' ')} (MWK)`), 'Daily Total (MWK)'];

    const rows = report.days.map((d: any) => {
      const line = [d.date];
      for (const m of methodKeys) {
        line.push(((d.methods[m]?.totalMinor || 0) / 100).toFixed(2));
      }
      line.push((d.dailyTotalMinor / 100).toFixed(2));
      return line;
    });

    const totalRow = ['"GRAND TOTAL"'];
    for (const m of methodKeys) {
      totalRow.push(((report.methodTotals[m]?.totalMinor || 0) / 100).toFixed(2));
    }
    totalRow.push((report.grandTotalMinor / 100).toFixed(2));
    rows.push(totalRow);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e: string[]) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `payments_received_${report.from}_${report.to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards by Method */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500 uppercase">Grand Total Received</div>
          <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
            {formatTambala(report.grandTotalMinor)}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{report.grandTotalCount} Transactions</div>
        </div>

        {methodKeys.map((m) => (
          <div
            key={m}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm"
          >
            <div className="text-xs font-medium text-slate-500 uppercase">
              {m.replace('_', ' ')}
            </div>
            <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
              {formatTambala(report.methodTotals[m]?.totalMinor || 0)}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {report.methodTotals[m]?.count || 0} Payments
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Daily Collections Breakdown
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
                <th className="py-3 px-4">Date</th>
                {methodKeys.map((m) => (
                  <th key={m} className="py-3 px-4 text-right">
                    {m.replace('_', ' ')}
                  </th>
                ))}
                <th className="py-3 px-4 text-right">Daily Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.days.length === 0 ? (
                <tr>
                  <td colSpan={methodKeys.length + 2} className="py-12 text-center text-slate-400">
                    No payments found within the selected date range.
                  </td>
                </tr>
              ) : (
                report.days.map((day: any) => (
                  <tr key={day.date} className="hover:bg-slate-50/50">
                    <td className="py-3 px-4 font-mono font-medium text-slate-900 dark:text-slate-100">
                      {day.date}
                    </td>
                    {methodKeys.map((m) => (
                      <td key={m} className="py-3 px-4 text-right font-mono">
                        {day.methods[m] ? formatTambala(day.methods[m].totalMinor) : '—'}
                      </td>
                    ))}
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                      {formatTambala(day.dailyTotalMinor)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {report.days.length > 0 && (
              <tfoot className="bg-slate-50 dark:bg-slate-800 font-bold border-t-2 border-slate-300 dark:border-slate-700">
                <tr>
                  <td className="py-3 px-4">GRAND TOTALS</td>
                  {methodKeys.map((m) => (
                    <td key={m} className="py-3 px-4 text-right font-mono">
                      {formatTambala(report.methodTotals[m]?.totalMinor || 0)}
                    </td>
                  ))}
                  <td className="py-3 px-4 text-right font-mono text-slate-900 dark:text-slate-100 text-sm">
                    {formatTambala(report.grandTotalMinor)}
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
