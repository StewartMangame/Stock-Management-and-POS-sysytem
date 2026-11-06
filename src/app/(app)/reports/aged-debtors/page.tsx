import React from 'react';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getAgedDebtors } from '@/server/services/reports/aged-debtors';
import { getLocations } from '@/server/services/locations';
import { formatTambala } from '@/lib/money';
import { todayInCompanyTz } from '@/lib/timezone';
import Link from 'next/link';
import { Download, Calendar, Filter, FileText } from 'lucide-react';
import { AgedDebtorsClient } from './AgedDebtorsClient';

export default async function AgedDebtorsPage({
  searchParams,
}: {
  searchParams: Promise<{
    asOf?: string;
    locationId?: string;
  }>;
}) {
  await authorize(PERMISSIONS.REPORTS_VIEW);

  const params = await searchParams;
  const asOf = params.asOf && params.asOf.trim() !== '' ? params.asOf.trim() : todayInCompanyTz();
  const locationId = params.locationId && params.locationId.trim() !== '' ? params.locationId.trim() : undefined;

  const report = await getAgedDebtors(asOf, locationId);
  const locations = await getLocations();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Aged Debtors Ledger
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Historical point-in-time aging analysis of outstanding customer accounts receivable.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/api/pdf/aged_debtors/report?asOf=${asOf}${locationId ? `&locationId=${locationId}` : ''}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-sm"
          >
            <Download className="w-4 h-4" />
            Export PDF
          </a>
        </div>
      </div>

      {/* Filter form */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              As Of Date
            </label>
            <input
              type="date"
              name="asOf"
              defaultValue={asOf}
              className="text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Location
            </label>
            <select
              name="locationId"
              defaultValue={locationId || ''}
              className="text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5"
            >
              <option value="">All Locations</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="px-4 py-1.5 text-sm font-medium rounded-lg bg-slate-800 text-white hover:bg-slate-700 transition-colors"
          >
            Run Report
          </button>
        </form>
      </div>

      {/* Interactive Report View & CSV Export */}
      <AgedDebtorsClient report={report} />
    </div>
  );
}
