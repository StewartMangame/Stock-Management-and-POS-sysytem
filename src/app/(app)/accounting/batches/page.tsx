'use client';

import React, { useState, useEffect } from 'react';
import {
  listJournalBatchesAction,
  generateBatchAction,
  exportBatchCsvAction,
} from '@/server/actions/accounting';
import { formatMwk } from '@/lib/money';
import {
  AlertTriangle,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Plus,
  ShieldAlert,
} from 'lucide-react';

export default function JournalBatchesPage() {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [startDate, setStartDate] = useState('2026-10-01');
  const [endDate, setEndDate] = useState('2026-10-31');

  // Re-export modal state
  const [reExportModalOpen, setReExportModalOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [managerId, setManagerId] = useState('');
  const [reason, setReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadBatches = async () => {
    setLoading(true);
    try {
      const list = await listJournalBatchesAction();
      setBatches(list);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBatches();
  }, []);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setErrorMsg(null);
    try {
      await generateBatchAction(startDate, endDate);
      await loadBatches();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleExportClick = async (batch: any) => {
    if (batch.status === 'exported') {
      setSelectedBatchId(batch.id);
      setReExportModalOpen(true);
      return;
    }
    await triggerExport(batch.id);
  };

  const triggerExport = async (batchId: string, reExport?: { approvedByManagerId: string; reason: string }) => {
    setErrorMsg(null);
    try {
      const res = await exportBatchCsvAction(batchId, reExport);
      // Trigger browser download of CSV content
      const blob = new Blob([res.csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', res.filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setReExportModalOpen(false);
      setReason('');
      await loadBatches();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileSpreadsheet className="h-7 w-7 text-indigo-600" />
            General Ledger Journal Batches
            <span className="bg-amber-100 text-amber-800 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-amber-300">
              DRAFT ONLY
            </span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Append-only double entry general ledger journal batches with automated balance verification.
          </p>
        </div>
      </div>

      {/* DRAFT Watermark Banner */}
      <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg shadow-sm">
        <div className="flex items-start">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 mr-3 shrink-0" />
          <div>
            <h3 className="text-sm font-bold text-amber-900">
              DRAFT EXPORT — PLACEHOLDER ACCOUNT CODES ACTIVE
            </h3>
            <p className="text-xs text-amber-800 mt-1">
              General ledger accounts are currently populated with standard baseline placeholder codes.
              All journal exports are watermarked as <strong>DRAFT</strong> and must NOT be submitted
              to MRA or statutory auditors until final chart of accounts sign-off.
            </p>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg text-sm text-red-700 flex items-center gap-2">
          <XCircle className="h-5 w-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Generation Form */}
      <div className="bg-white p-5 rounded-lg border shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
          <Plus className="h-4 w-4 text-indigo-600" />
          Create New Journal Batch
        </h2>
        <form onSubmit={handleGenerate} className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Period Start</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Period End</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm"
              required
            />
          </div>
          <button
            type="submit"
            disabled={generating}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm px-4 py-2 rounded shadow-sm disabled:opacity-50 flex items-center gap-2"
          >
            {generating ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
            Generate Batch
          </button>
        </form>
      </div>

      {/* Batches Table */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">
            Generated Batches ({batches.length})
          </h2>
          <button
            onClick={loadBatches}
            className="text-gray-500 hover:text-gray-700 text-xs flex items-center gap-1"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Batch Number</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Period</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">Total Debits</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">Total Credits</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Balance Check</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-500">
                    Loading batches...
                  </td>
                </tr>
              ) : batches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400">
                    No journal batches generated yet. Select a date range above to create one.
                  </td>
                </tr>
              ) : (
                batches.map((b) => {
                  const isBalanced = Number(b.totalDebitMinor) === Number(b.totalCreditMinor);
                  return (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono font-medium text-gray-900">
                        {b.batchNumber}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {new Date(b.periodStart).toLocaleDateString()} — {new Date(b.periodEnd).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-800">
                        {formatMwk(b.totalDebitMinor)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-800">
                        {formatMwk(b.totalCreditMinor)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isBalanced ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full text-xs font-semibold">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Balanced
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-700 bg-red-50 px-2.5 py-0.5 rounded-full text-xs font-semibold">
                            <XCircle className="h-3.5 w-3.5" /> Imbalanced
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${
                            b.status === 'exported'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleExportClick(b)}
                          className={`text-xs px-3 py-1.5 rounded font-medium border ${
                            b.status === 'exported'
                              ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
                              : 'border-indigo-300 text-indigo-700 hover:bg-indigo-50'
                          }`}
                        >
                          {b.status === 'exported' ? 'Re-Export CSV...' : 'Export CSV (DRAFT)'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Re-export Modal */}
      {reExportModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-lg">
              <ShieldAlert className="h-6 w-6 text-amber-600" />
              Manager Re-Export Authorization
            </div>
            <p className="text-xs text-gray-600">
              This batch has already been exported. Re-exporting general ledger data requires explicit manager confirmation and an audited business reason.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Manager User ID</label>
                <input
                  type="text"
                  placeholder="Enter manager UUID or ID"
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value)}
                  className="w-full border rounded px-3 py-1.5 text-xs font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Reason for Re-Export</label>
                <textarea
                  placeholder="State reason (e.g., downstream import corrupted, audit review request)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-xs"
                  rows={3}
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setReExportModalOpen(false)}
                className="px-3 py-1.5 border rounded text-xs text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!selectedBatchId || !managerId || !reason.trim()) {
                    setErrorMsg('Manager ID and reason are required for re-export.');
                    return;
                  }
                  triggerExport(selectedBatchId, { approvedByManagerId: managerId, reason });
                }}
                className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700"
              >
                Approve & Re-Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

