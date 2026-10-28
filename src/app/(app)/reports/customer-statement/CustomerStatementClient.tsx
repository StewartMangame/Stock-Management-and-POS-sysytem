'use client';

import React from 'react';
import Link from 'next/link';
import { formatTambala } from '@/lib/money';
import { Download, FileSpreadsheet, ArrowUpRight, ArrowDownLeft } from 'lucide-react';

export function CustomerStatementClient({ statement }: { statement: any }) {
  const handleExportCsv = () => {
    const headers = [
      'Date',
      'Reference',
      'Type',
      'Description',
      'Debit (MWK)',
      'Credit (MWK)',
      'Running Balance (MWK)',
    ];

    const rows: string[][] = [];

    // Opening balance row
    rows.push([
      statement.period.from,
      'OPENING',
      'opening',
      'Opening Balance',
      '0.00',
      '0.00',
      (statement.openingBalanceMinor / 100).toFixed(2),
    ]);

    for (const l of statement.lines) {
      rows.push([
        l.date,
        `"${l.reference}"`,
        l.type,
        `"${l.description.replace(/"/g, '""')}"`,
        (l.debitMinor / 100).toFixed(2),
        (l.creditMinor / 100).toFixed(2),
        (l.runningBalanceMinor / 100).toFixed(2),
      ]);
    }

    // Closing balance row
    rows.push([
      statement.period.to,
      'CLOSING',
      'closing',
      'Closing Balance',
      (statement.totalDebitsMinor / 100).toFixed(2),
      (statement.totalCreditsMinor / 100).toFixed(2),
      (statement.closingBalanceMinor / 100).toFixed(2),
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `statement_${statement.customer.accountNumber}_${statement.period.from}_${statement.period.to}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      {/* Account Balance Summary Card */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500 uppercase">Opening Balance</div>
          <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
            {formatTambala(statement.openingBalanceMinor)}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">As of {statement.period.from}</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500 uppercase">Period Invoiced (Debits)</div>
          <div className="text-xl font-bold text-blue-600 mt-1">
            {formatTambala(statement.totalDebitsMinor)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500 uppercase">Period Paid (Credits)</div>
          <div className="text-xl font-bold text-emerald-600 mt-1">
            {formatTambala(statement.totalCreditsMinor)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500 uppercase">Closing Balance Due</div>
          <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
            {formatTambala(statement.closingBalanceMinor)}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">As of {statement.period.to}</div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Account Activity: {statement.customer.name}
            </h3>
            <p className="text-xs text-slate-500">Account: {statement.customer.accountNumber}</p>
          </div>
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
                <th className="py-3 px-4">Reference</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Description</th>
                <th className="py-3 px-4 text-right">Debit (MWK)</th>
                <th className="py-3 px-4 text-right">Credit (MWK)</th>
                <th className="py-3 px-4 text-right">Balance (MWK)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {/* Opening Balance Row */}
              <tr className="bg-slate-50/40 dark:bg-slate-800/20 font-semibold">
                <td className="py-2.5 px-4 font-mono">{statement.period.from}</td>
                <td className="py-2.5 px-4 font-mono">OPENING</td>
                <td className="py-2.5 px-4">Opening</td>
                <td className="py-2.5 px-4 italic">Opening Balance B/F</td>
                <td className="py-2.5 px-4 text-right">—</td>
                <td className="py-2.5 px-4 text-right">—</td>
                <td className="py-2.5 px-4 text-right font-mono text-slate-900 dark:text-slate-100">
                  {formatTambala(statement.openingBalanceMinor)}
                </td>
              </tr>

              {statement.lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No transactions occurred within this date range.
                  </td>
                </tr>
              ) : (
                statement.lines.map((l: any) => (
                  <tr key={l.id} className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-4 font-mono">{l.date}</td>
                    <td className="py-2.5 px-4 font-mono font-medium text-slate-900 dark:text-slate-100">
                      {l.reference}
                    </td>
                    <td className="py-2.5 px-4 uppercase text-[10px] tracking-wider font-semibold">
                      <span
                        className={`px-1.5 py-0.5 rounded ${
                          l.type === 'invoice'
                            ? 'bg-blue-100 text-blue-800'
                            : l.type === 'receipt'
                            ? 'bg-emerald-100 text-emerald-800'
                            : l.type === 'credit_note'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {l.type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">{l.description}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-900 dark:text-slate-100 font-medium">
                      {l.debitMinor > 0 ? formatTambala(l.debitMinor) : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-emerald-700 dark:text-emerald-400 font-medium">
                      {l.creditMinor > 0 ? formatTambala(l.creditMinor) : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                      {formatTambala(l.runningBalanceMinor)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="bg-slate-50 dark:bg-slate-800 font-bold border-t-2 border-slate-300 dark:border-slate-700">
              <tr>
                <td colSpan={4} className="py-3 px-4">
                  CLOSING BALANCE DUE
                </td>
                <td className="py-3 px-4 text-right font-mono">
                  {formatTambala(statement.totalDebitsMinor)}
                </td>
                <td className="py-3 px-4 text-right font-mono text-emerald-700 dark:text-emerald-400">
                  {formatTambala(statement.totalCreditsMinor)}
                </td>
                <td className="py-3 px-4 text-right font-mono text-slate-900 dark:text-slate-100 text-sm">
                  {formatTambala(statement.closingBalanceMinor)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
