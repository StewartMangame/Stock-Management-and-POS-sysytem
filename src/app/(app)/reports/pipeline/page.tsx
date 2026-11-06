import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getSalesPipeline } from '@/server/services/reports/warranty-pipeline-report';
import { getLocations } from '@/server/services/locations';
import { todayInCompanyTz } from '@/lib/timezone';
import { ReportViewer } from '@/components/reports/ReportViewer';

export const metadata: Metadata = { title: 'Sales Pipeline' };

export default async function PipelineReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    locationId?: string;
    expiringDays?: string;
  }>;
}) {
  const actor = await authorize(PERMISSIONS.REPORTS_VIEW);
  const params = await searchParams;

  const locationId = params.locationId || undefined;
  const expiringDays = parseInt(params.expiringDays || '7', 10);
  const today = todayInCompanyTz();

  const locations = await getLocations();
  const locationName = locationId
    ? (locations.find((l) => l.id === locationId)?.name ?? locationId)
    : 'All Locations';

  // Service takes optional locationId string
  const data = await getSalesPipeline(locationId);

  type AnyRow = Record<string, any>;
  // Show only open quotations in the main table
  const rows: AnyRow[] = (data.rows as unknown as AnyRow[]).filter((r) => r.status === 'open');

  const columns = [
    { key: 'quotationNumber', header: 'Quote #' },
    { key: 'customerName', header: 'Customer' },
    { key: 'issueDate', header: 'Issued' },
    { key: 'expiresDate', header: 'Expires' },
    { key: 'daysOpen', header: 'Days Open', isNumber: true, align: 'right' as const },
    { key: 'totalMinor', header: 'Value (MWK)', isCurrency: true, align: 'right' as const },
    { key: 'status', header: 'Status' },
    { key: 'isExpiringSoon', header: 'Expiring Soon' },
  ];

  const expiringSoon = rows.filter((r) => {
    if (!r.expiresDate) return false;
    const exp = new Date(r.expiresDate as string);
    const cutoff = new Date(Date.now() + expiringDays * 86400000);
    return exp <= cutoff && exp > new Date();
  });

  const summarySection = (
    <div className="mt-4 grid grid-cols-3 gap-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center">
        <p className="text-2xl font-bold text-ace-navy">{data.totals.totalOpen}</p>
        <p className="text-sm text-gray-600 mt-1">Open Quotations</p>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
        <p className="text-2xl font-bold text-amber-700">{expiringSoon.length}</p>
        <p className="text-sm text-amber-600 mt-1">Expiring in ≤ {expiringDays} days</p>
      </div>
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
        <p className="text-2xl font-bold text-green-700">{data.totals.conversionRate}%</p>
        <p className="text-sm text-green-600 mt-1">Conversion Rate</p>
      </div>
    </div>
  );

  const filterForm = (
    <form method="GET" className="flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Expiring Within (Days)</label>
        <input
          type="number"
          name="expiringDays"
          defaultValue={expiringDays}
          min={1}
          max={90}
          className="text-sm rounded-lg border border-gray-300 px-3 py-1.5 w-20"
        />
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
  );

  return (
    <ReportViewer
      reportId="sales-pipeline"
      title="Sales Pipeline"
      description="Open quotations sorted by issue date. Conversion rate is based on all quotations ever recorded."
      columns={columns}
      rows={rows}
      totals={{
        totalValueMinor: data.totals.totalValueMinor,
        count: rows.length,
        converted: data.totals.convertedCount,
        expired: data.totals.expiredCount,
      }}
      totalCount={rows.length}
      generatedAt={new Date().toISOString()}
      generatedBy={actor.name}
      filterSummary={{ asOf: today, location: locationName }}
      filterForm={filterForm}
      queryParams={{ expiringDays: String(expiringDays), ...(locationId ? { locationId } : {}) }}
      extraSections={summarySection}
    />
  );
}
