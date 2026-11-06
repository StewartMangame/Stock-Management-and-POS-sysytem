import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getVatSummary } from '@/server/services/reports/vat-report';
import { getLocations } from '@/server/services/locations';
import { todayInCompanyTz } from '@/lib/timezone';
import { formatTambala } from '@/lib/money';

export const metadata: Metadata = { title: 'VAT Summary' };

export default async function VatReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; locationId?: string }>;
}) {
  const actor = await authorize(PERMISSIONS.REPORTS_COST);
  const params = await searchParams;

  const today = todayInCompanyTz();
  const firstOfMonth = today.slice(0, 8) + '01';
  const from = params.from || firstOfMonth;
  const to = params.to || today;
  const locationId = params.locationId || undefined;

  const locations = await getLocations();
  const locationName = locationId
    ? (locations.find((l) => l.id === locationId)?.name ?? locationId)
    : 'All Locations';

  const report = await getVatSummary(from, to, locationId);

  const csvParams = new URLSearchParams({ from, to, ...(locationId ? { locationId } : {}), format: 'csv' });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">VAT Summary</h1>
          <p className="text-sm text-ace-muted mt-1">Output tax by rate. Rates read from database records.</p>
        </div>
        <a
          href={`/api/reports/vat-summary?${csvParams.toString()}`}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-ace-band text-ace-navy hover:bg-ace-band"
        >
          Export CSV
        </a>
      </div>

      {/* Disclaimer */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 font-medium">
        ⚠️ {report.disclaimer}
      </div>

      {/* Metadata */}
      <div className="rounded-lg border border-ace-band bg-ace-band/40 px-4 py-3 text-xs text-ace-muted space-y-1">
        <div><span className="font-medium text-ace-navy">Period:</span> {from} – {to}</div>
        <div><span className="font-medium text-ace-navy">Location:</span> {locationName}</div>
        <div><span className="font-medium text-ace-navy">Generated:</span> {new Date(report.generatedAt).toLocaleString('en-GB', { timeZone: 'Africa/Blantyre' })} · <span className="font-medium text-ace-navy">By:</span> {actor.name}</div>
      </div>

      {/* Filter form */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <form method="GET" className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input type="date" name="from" defaultValue={from} className="text-sm rounded-lg border border-gray-300 px-3 py-1.5" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input type="date" name="to" defaultValue={to} className="text-sm rounded-lg border border-gray-300 px-3 py-1.5" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Location</label>
            <select name="locationId" defaultValue={locationId ?? ''} className="text-sm rounded-lg border border-gray-300 px-3 py-1.5">
              <option value="">All Locations</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <button type="submit" className="px-4 py-1.5 text-sm font-medium rounded-lg bg-ace-navy text-white hover:bg-ace-navy/90">
            Run Report
          </button>
        </form>
      </div>

      {/* VAT table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
              <th className="px-4 py-3 text-left">VAT Rate</th>
              <th className="px-4 py-3 text-right">Rate %</th>
              <th className="px-4 py-3 text-right">Taxable Sales (MWK)</th>
              <th className="px-4 py-3 text-right">Output VAT (MWK)</th>
              <th className="px-4 py-3 text-right">Credit Notes Taxable</th>
              <th className="px-4 py-3 text-right">Credit VAT</th>
              <th className="px-4 py-3 text-right">Net Taxable (MWK)</th>
              <th className="px-4 py-3 text-right font-bold">Net VAT (MWK)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">No VAT transactions for this period.</td>
              </tr>
            ) : (
              report.rows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-700">{r.rateName}</td>
                  <td className="px-4 py-3 text-right text-gray-700 tabular-nums">{r.ratePercent}%</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatTambala(r.taxableSalesMinor)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatTambala(r.outputVatMinor)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-600">{formatTambala(r.taxableCreditMinor)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-600">{formatTambala(r.creditVatMinor)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{formatTambala(r.netTaxableMinor)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-ace-navy">{formatTambala(r.netVatMinor)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-bold text-sm">
            <tr>
              <td className="px-4 py-3 text-gray-900">TOTAL</td>
              <td></td>
              <td className="px-4 py-3 text-right tabular-nums">{formatTambala(report.totals.totalTaxableSalesMinor)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatTambala(report.totals.totalOutputVatMinor)}</td>
              <td></td>
              <td className="px-4 py-3 text-right tabular-nums text-red-600">{formatTambala(report.totals.totalCreditVatMinor)}</td>
              <td></td>
              <td className="px-4 py-3 text-right tabular-nums text-ace-navy">{formatTambala(report.totals.netOutputVatMinor)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* EIS Status Counts */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">EIS Submission Status for Period</h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {(Object.entries(report.eisCounts) as [string, number][]).map(([status, count]) => (
            <div key={status} className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-center">
              <p className="text-2xl font-bold text-ace-navy">{count}</p>
              <p className="text-xs text-gray-500 capitalize mt-1">{status.replace('_', ' ')}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

