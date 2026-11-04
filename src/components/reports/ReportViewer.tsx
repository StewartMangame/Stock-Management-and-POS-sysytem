'use client';

import React, { useState, useTransition } from 'react';
import { Download, FileText, Printer, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatTambala } from '@/lib/money';

export interface ReportColumn {
  key: string;
  header: string;
  isCurrency?: boolean;
  isNumber?: boolean;
  align?: 'left' | 'right' | 'center';
}

interface ReportViewerProps {
  reportId: string;
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: Record<string, any>[];
  totals?: Record<string, any>;
  totalCount: number;
  generatedAt: string;
  generatedBy: string;
  filterSummary: {
    period?: string;
    asOf?: string;
    location?: string;
    extra?: Record<string, string>;
  };
  filterForm?: React.ReactNode;
  disclaimer?: string;
  /** Extra sections to render below main table (e.g. "Invoiced, Not Yet Delivered") */
  extraSections?: React.ReactNode;
  /** Query params to pass through for CSV/PDF download */
  queryParams: Record<string, string>;
}

const PDF_ROW_LIMIT = 2000;

export function ReportViewer({
  reportId,
  title,
  description,
  columns,
  rows,
  totals,
  totalCount,
  generatedAt,
  generatedBy,
  filterSummary,
  filterForm,
  disclaimer,
  extraSections,
  queryParams,
}: ReportViewerProps) {
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const totalPages = Math.ceil(rows.length / pageSize);
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  const csvParams = new URLSearchParams({ ...queryParams, format: 'csv' });
  const csvUrl = `/api/reports/${reportId}?${csvParams.toString()}`;

  const pdfParams = new URLSearchParams({ ...queryParams, format: 'pdf' });
  const pdfUrl = `/api/reports/${reportId}?${pdfParams.toString()}`;

  function formatCell(col: ReportColumn, value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (col.isCurrency && typeof value === 'number') return formatTambala(value);
    if (col.isNumber && typeof value === 'number') return value.toLocaleString();
    return String(value);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">{title}</h1>
          <p className="text-sm text-ace-muted mt-1">{description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={csvUrl}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-ace-band text-ace-navy hover:bg-ace-band transition-colors"
          >
            <Download className="h-4 w-4" />
            CSV
          </a>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-ace-navy text-white hover:bg-ace-navy/90 transition-colors"
          >
            <FileText className="h-4 w-4" />
            PDF
          </a>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-ace-band text-ace-navy hover:bg-ace-band transition-colors"
          >
            <Printer className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Report metadata */}
      <div className="rounded-lg border border-ace-band bg-ace-band/40 px-4 py-3 text-xs text-ace-muted space-y-1">
        {filterSummary.period && (
          <div><span className="font-medium text-ace-navy">Period:</span> {filterSummary.period}</div>
        )}
        {filterSummary.asOf && (
          <div><span className="font-medium text-ace-navy">As of:</span> {filterSummary.asOf}</div>
        )}
        <div><span className="font-medium text-ace-navy">Location:</span> {filterSummary.location ?? 'All Locations'}</div>
        <div><span className="font-medium text-ace-navy">Generated:</span> {new Date(generatedAt).toLocaleString('en-GB', { timeZone: 'Africa/Blantyre' })} · <span className="font-medium text-ace-navy">By:</span> {generatedBy}</div>
        {disclaimer && (
          <div className="mt-1 pt-1 border-t border-ace-band text-amber-700 font-medium">{disclaimer}</div>
        )}
      </div>

      {/* PDF limit warning when rows exceed 2000 */}
      {totalCount > PDF_ROW_LIMIT && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠️ <strong>PDF capped at {PDF_ROW_LIMIT.toLocaleString()} rows.</strong> This report has {totalCount.toLocaleString()} rows. Use CSV export for the full dataset.
        </div>
      )}

      {/* Filter form */}
      {filterForm && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          {filterForm}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide ${
                      col.align === 'right' || col.isCurrency || col.isNumber
                        ? 'text-right'
                        : 'text-left'
                    }`}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-gray-400">
                    No data for the selected period.
                  </td>
                </tr>
              ) : (
                pagedRows.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50 transition-colors">
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-2.5 text-sm text-gray-700 ${
                          col.align === 'right' || col.isCurrency || col.isNumber
                            ? 'text-right tabular-nums'
                            : ''
                        }`}
                      >
                        {formatCell(col, row[col.key])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {/* Totals row */}
            {totals && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  {columns.map((col, i) => (
                    <td
                      key={col.key}
                      className={`px-4 py-3 text-sm text-gray-900 ${
                        col.align === 'right' || col.isCurrency || col.isNumber
                          ? 'text-right tabular-nums'
                          : ''
                      }`}
                    >
                      {i === 0
                        ? 'TOTALS'
                        : totals[col.key] !== undefined
                        ? formatCell(col, totals[col.key])
                        : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
            <span className="text-xs text-gray-500">
              Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, rows.length)} of {rows.length.toLocaleString()} rows
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded text-gray-400 hover:text-gray-600 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-gray-500 px-2">{page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded text-gray-400 hover:text-gray-600 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Extra sections */}
      {extraSections}
    </div>
  );
}

