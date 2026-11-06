'use client';

import React, { useState, useTransition } from 'react';
import { runSystemChecksAction } from './actions';
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Play,
  Clock,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';

interface CheckItem {
  code: string;
  name: string;
  status: 'pass' | 'warning' | 'fail';
  summary: string;
  discrepancyCount: number;
  details?: Record<string, unknown>[];
}

interface SuiteResult {
  id: string;
  executedAt: string;
  status: 'pass' | 'warning' | 'fail';
  totalChecks: number;
  passedCount: number;
  warningCount: number;
  failedCount: number;
  durationMs: number;
  checks: CheckItem[];
}

export function SystemChecksClient({
  initialHistory,
}: {
  initialHistory: any[];
}) {
  const [history, setHistory] = useState<any[]>(initialHistory);
  const [latestResult, setLatestResult] = useState<SuiteResult | null>(
    initialHistory[0]
      ? {
          id: initialHistory[0].id,
          executedAt: new Date(initialHistory[0].executedAt).toISOString(),
          status: initialHistory[0].status,
          totalChecks: initialHistory[0].totalChecks,
          passedCount: initialHistory[0].passedCount,
          warningCount: initialHistory[0].warningCount,
          failedCount: initialHistory[0].failedCount,
          durationMs: initialHistory[0].durationMs,
          checks: (initialHistory[0].details as CheckItem[]) || [],
        }
      : null,
  );
  const [isPending, startTransition] = useTransition();
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);

  const handleRunChecks = () => {
    startTransition(async () => {
      try {
        const res = await runSystemChecksAction();
        if (res.success && res.result) {
          setLatestResult(res.result);
          setHistory((prev) => [
            {
              id: res.result.id,
              executedAt: res.result.executedAt,
              status: res.result.status,
              totalChecks: res.result.totalChecks,
              passedCount: res.result.passedCount,
              warningCount: res.result.warningCount,
              failedCount: res.result.failedCount,
              durationMs: res.result.durationMs,
              details: res.result.checks,
              executedByUser: { name: 'Current User' },
            },
            ...prev,
          ]);
        }
      } catch (err: any) {
        alert(err.message || 'Failed to run system checks');
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Trigger */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-ace-navy" />
            Automated System Health Checks
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Execute real-time cross-module integrity validation across inventory, debtors, serials, and documents.
          </p>
        </div>

        <button
          onClick={handleRunChecks}
          disabled={isPending}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ace-navy text-white text-sm font-semibold rounded-lg hover:bg-ace-navy/90 disabled:opacity-50 transition-colors shadow-sm"
        >
          {isPending ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Running Invariants...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              Run Health Checks Now
            </>
          )}
        </button>
      </div>

      {/* Latest Run KPI Summary */}
      {latestResult && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Overall Status</div>
            <div className="mt-2 flex items-center gap-2">
              {latestResult.status === 'pass' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5" /> ALL PASS
                </span>
              )}
              {latestResult.status === 'warning' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  <AlertTriangle className="w-3.5 h-3.5" /> WARNINGS
                </span>
              )}
              {latestResult.status === 'fail' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                  <XCircle className="w-3.5 h-3.5" /> FAILURES DETECTED
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 mt-2">
              Executed {new Date(latestResult.executedAt).toLocaleTimeString()} ({latestResult.durationMs}ms)
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Passed Checks</div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">{latestResult.passedCount}</div>
            <div className="text-xs text-slate-400 mt-1">of {latestResult.totalChecks} checks verified</div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Warnings</div>
            <div className="text-2xl font-bold text-amber-600 mt-1">{latestResult.warningCount}</div>
            <div className="text-xs text-slate-400 mt-1">Non-critical alerts</div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Failed Checks</div>
            <div className="text-2xl font-bold text-rose-600 mt-1">{latestResult.failedCount}</div>
            <div className="text-xs text-slate-400 mt-1">Invariants breached</div>
          </div>
        </div>
      )}

      {/* Itemized Checks List */}
      {latestResult && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 font-semibold text-sm text-slate-900 dark:text-slate-100 bg-slate-50/50 dark:bg-slate-800/50">
            Current Health Invariants ({latestResult.checks.length} Subsystems)
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {latestResult.checks.map((chk) => {
              const isExpanded = expandedCheck === chk.code;
              return (
                <div key={chk.code} className="p-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {chk.status === 'pass' && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                        {chk.status === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500" />}
                        {chk.status === 'fail' && <XCircle className="w-5 h-5 text-rose-500" />}
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                          {chk.name}
                          <span className="font-mono text-xs text-slate-400">({chk.code})</span>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">
                          {chk.summary}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {chk.discrepancyCount > 0 && (
                        <button
                          onClick={() => setExpandedCheck(isExpanded ? null : chk.code)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-ace-navy hover:underline"
                        >
                          {isExpanded ? 'Hide Details' : `Inspect (${chk.discrepancyCount})`}
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expandable Details Table */}
                  {isExpanded && chk.details && chk.details.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 overflow-x-auto">
                      <table className="min-w-full text-xs text-left">
                        <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                          <tr>
                            {Object.keys(chk.details[0]!).map((col) => (
                              <th key={col} className="px-3 py-1.5 font-medium">{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {chk.details.map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              {Object.values(row).map((val: any, cidx) => (
                                <td key={cidx} className="px-3 py-1.5 font-mono text-slate-600 dark:text-slate-300">
                                  {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Historical Execution Log */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 font-semibold text-sm text-slate-900 dark:text-slate-100 bg-slate-50/50 dark:bg-slate-800/50 flex items-center justify-between">
          <span>Execution History (Last {history.length} Runs)</span>
          <Clock className="w-4 h-4 text-slate-400" />
        </div>

        {history.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No system checks have been executed yet. Click &quot;Run Health Checks Now&quot; above to perform the first run.
          </div>
        ) : (
          <table className="min-w-full text-sm text-left">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 text-xs font-medium uppercase tracking-wider">
              <tr>
                <th className="px-5 py-2.5">Executed At</th>
                <th className="px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5">Passed / Total</th>
                <th className="px-5 py-2.5">Duration</th>
                <th className="px-5 py-2.5">Initiated By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {history.map((h) => (
                <tr key={h.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                  <td className="px-5 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                    {new Date(h.executedAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-3">
                    {h.status === 'pass' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        PASS
                      </span>
                    )}
                    {h.status === 'warning' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        WARN
                      </span>
                    )}
                    {h.status === 'fail' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                        FAIL
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-700 dark:text-slate-300">
                    {h.passedCount} / {h.totalChecks}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">
                    {h.durationMs}ms
                  </td>
                  <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                    {h.executedByUser?.name || 'Automated / System'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

