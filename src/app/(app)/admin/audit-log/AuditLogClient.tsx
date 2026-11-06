'use client';

import React, { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  History,
  ShieldAlert,
  Briefcase,
  Search,
  Filter,
  Calendar,
  ChevronDown,
  ChevronRight,
  User,
  ExternalLink,
} from 'lucide-react';
import type { AuditLogEntry } from '@/server/services/audit-log';

export function AuditLogClient({
  initialEntries,
  totalCount,
  canViewSecurity,
  currentCategory,
  currentEntityType,
  currentFrom,
  currentTo,
}: {
  initialEntries: AuditLogEntry[];
  totalCount: number;
  canViewSecurity: boolean;
  currentCategory: string;
  currentEntityType: string;
  currentFrom: string;
  currentTo: string;
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [category, setCategory] = useState(currentCategory || 'all');
  const [entityType, setEntityType] = useState(currentEntityType || '');
  const [from, setFrom] = useState(currentFrom || '');
  const [to, setTo] = useState(currentTo || '');

  const handleApplyFilter = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (category && category !== 'all') params.set('category', category);
    if (entityType) params.set('entityType', entityType);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    router.push(`/admin/audit-log?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      {/* Category Pills & Filters */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              onClick={() => {
                setCategory('all');
                router.push(`/admin/audit-log?category=all${entityType ? `&entityType=${entityType}` : ''}`);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                category === 'all'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              All Events ({totalCount})
            </button>
            <button
              onClick={() => {
                setCategory('business');
                router.push(`/admin/audit-log?category=business${entityType ? `&entityType=${entityType}` : ''}`);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                category === 'business'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5 text-blue-500" />
              Business Events
            </button>
            {canViewSecurity && (
              <button
                onClick={() => {
                  setCategory('security');
                  router.push(`/admin/audit-log?category=security${entityType ? `&entityType=${entityType}` : ''}`);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  category === 'security'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                Security Events
              </button>
            )}
          </div>

          <div className="text-xs text-slate-400">
            Immutable Audit Trail (Append-Only)
          </div>
        </div>

        {/* Filter Form */}
        <form onSubmit={handleApplyFilter} className="flex flex-wrap items-end gap-3 text-sm">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Entity Type</label>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100"
            >
              <option value="">All Entities</option>
              <option value="sales_document">Sales Invoices & Credit Notes</option>
              <option value="payment">Payments</option>
              <option value="stock_movement">Stock Movements</option>
              <option value="customer">Customers</option>
              <option value="product">Products</option>
              <option value="system">System Events</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">From Date</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">To Date</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-slate-900 dark:text-slate-100"
            />
          </div>

          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-ace-navy text-white hover:bg-ace-navy/90 transition-colors shadow-sm"
          >
            Filter Logs
          </button>
        </form>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 font-semibold text-sm text-slate-900 dark:text-slate-100 bg-slate-50/50 dark:bg-slate-800/50 flex items-center justify-between">
          <span>Audit Records ({initialEntries.length} displayed of {totalCount})</span>
          <History className="w-4 h-4 text-slate-400" />
        </div>

        {initialEntries.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No audit records found matching the applied filter criteria.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {initialEntries.map((log) => {
              const isExpanded = expandedId === log.id;
              return (
                <div key={log.id} className="p-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {log.category === 'security' ? (
                          <ShieldAlert className="w-4 h-4 text-rose-500" />
                        ) : (
                          <Briefcase className="w-4 h-4 text-blue-500" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                            {log.action}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            {log.entityType}
                          </span>
                          {log.entityId && (
                            <span className="font-mono text-xs text-slate-400 truncate max-w-[150px]">
                              id:{log.entityId}
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-3">
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
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                        >
                          {isExpanded ? 'Hide Diff' : 'View Diff'}
                          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Diff Inspector */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                      {log.before && (
                        <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                          <div className="font-bold text-slate-500 mb-1">State Before:</div>
                          <pre className="text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(log.before, null, 2)}
                          </pre>
                        </div>
                      )}
                      {log.after && (
                        <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                          <div className="font-bold text-slate-500 mb-1">State After:</div>
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
        )}
      </div>
    </div>
  );
}

