import React from 'react';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getPaymentsReport } from '@/server/services/reports/payments-report';
import { getLocations } from '@/server/services/locations';
import { PaymentsReceivedClient } from './PaymentsReceivedClient';

export default async function PaymentsReceivedPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    locationId?: string;
  }>;
}) {
  await authorize(PERMISSIONS.REPORTS_VIEW);

  const params = await searchParams;
  const to = params.to || new Date().toISOString().slice(0, 10);
  const from =
    params.from ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const locationId = params.locationId || undefined;

  const report = await getPaymentsReport(from, to, locationId);
  const locations = await getLocations();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Payments Received Summary
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Daily collection analysis grouped by payment method (cash, bank transfer, card, mobile money).
        </p>
      </div>

      {/* Filter Form */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
        <form method="GET" className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
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

          <div>
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

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Location
            </label>
            <select
              name="locationId"
              defaultValue={locationId || ''}
              className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5"
            >
              <option value="">All Locations</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <button
              type="submit"
              className="w-full px-4 py-1.5 text-sm font-medium rounded-lg bg-slate-800 text-white hover:bg-slate-700 transition-colors"
            >
              Filter Collections
            </button>
          </div>
        </form>
      </div>

      <PaymentsReceivedClient report={report} />
    </div>
  );
}
