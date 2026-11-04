'use client';

import React, { useEffect, useState } from 'react';
import { History, User, Clock, ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react';
import { fetchEntityAuditHistoryAction } from '@/app/(app)/admin/audit-log/actions';
import type { AuditLogEntry } from '@/server/services/audit-log';

export function EntityHistoryTab({
  entityType,
  entityId,
  initialEntries,
}: {
  entityType: string;
  entityId: string;
  initialEntries?: AuditLogEntry[];
}) {
  const [entries, setEntries] = useState<AuditLogEntry[]>(initialEntries || []);
  const [loading, setLoading] = useState(!initialEntries);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialEntries) {
      let isMounted = true;
      setLoading(true);
      fetchEntityAuditHistoryAction(entityType, entityId)
        .then((data) => {
          if (isMounted) {
            setEntries(data);
            setLoading(false);
          }
        })
        .catch(() => {
          if (isMounted) setLoading(false);
        });
      return () => {
        isMounted = false;
      };
    }
  }, [entityType, entityId, initialEntries]);

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        Loading historical audit timeline...
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-slate-500 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
        <History className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        No audit events recorded for this record yet. Future actions will appear here automatically.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 font-semibold text-sm text-slate-900 dark:text-slate-100 bg-slate-50/50 dark:bg-slate-800/50 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <History className="w-4 h-4 text-ace-navy" />
          Audit Timeline ({entries.length} events)
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-600">
          <ShieldCheck className="w-3.5 h-3.5" /> Immutable
        </span>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {entries.map((log) => {
          const isExpanded = expandedId === log.id;
          return (
            <div key={log.id} className="p-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-ace-navy mt-1.5 shrink-0" />
                  <div>
                    <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                      {log.action}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {log.userName ? `${log.userName} (${log.userRole || 'User'})` : 'System / Auto'}
                      </span>
                      {log.ip && (
                        <span className="font-mono text-[11px] text-slate-400">
                          IP: {log.ip}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 sm:self-center">
                  <span className="font-mono text-xs text-slate-400 whitespace-nowrap">
                    {new Date(log.at).toLocaleString()}
                  </span>

                  {(log.before || log.after) && (
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                    >
                      {isExpanded ? 'Hide Diff' : 'View Changes'}
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              </div>

              {/* State diff */}
              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                  {log.before && (
                    <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded border border-slate-200 dark:border-slate-800">
                      <div className="font-bold text-slate-500 mb-1">Previous Values:</div>
                      <pre className="text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(log.before, null, 2)}
                      </pre>
                    </div>
                  )}
                  {log.after && (
                    <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded border border-slate-200 dark:border-slate-800">
                      <div className="font-bold text-slate-500 mb-1">New Values:</div>
                      <pre className="text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(log.after, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

