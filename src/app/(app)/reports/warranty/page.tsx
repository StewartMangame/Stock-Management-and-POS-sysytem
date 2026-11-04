import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getWarrantyExpiring } from '@/server/services/reports/warranty-pipeline-report';
import { getLocations } from '@/server/services/locations';
import { todayInCompanyTz } from '@/lib/timezone';
import { ReportViewer } from '@/components/reports/ReportViewer';

export const metadata: Metadata = { title: 'Warranty Report' };

export default async function WarrantyReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    locationId?: string;
    bucket?: string;
  }>;
}) {
  const actor = await authorize(PERMISSIONS.REPORTS_VIEW);
  const params = await searchParams;

  const locationId = params.locationId || undefined;
  const bucket = (params.bucket as '30' | '60' | '90') || '90';
  const today = todayInCompanyTz();

  const locations = await getLocations();
  const locationName = locationId
    ? (locations.find((l) => l.id === locationId)?.name ?? locationId)
    : 'All Locations';

  // Service takes optional locationId and returns warranties expiring within 90 days
  const data = await getWarrantyExpiring(locationId);

  type AnyRow = Record<string, any>;
  // Filter client-side by chosen bucket (30/60/90 days)
  const bucketDays = parseInt(bucket, 10);
  const rows: AnyRow[] = (data.rows as unknown as AnyRow[]).filter(
    (r) => (r.daysUntilExpiry as number) <= bucketDays,
  );

  const columns = [
    { key: 'serialNumber', header: 'Serial Number' },
    { key: 'productName', header: 'Product' },
    { key: 'customerName', header: 'Customer' },
    { key: 'warrantyExpiresAt', header: 'Warranty Expires' },
    { key: 'daysUntilExpiry', header: 'Days Remaining', isNumber: true, align: 'right' as const },
    { key: 'bucket', header: 'Bucket' },
  ];

  const allRows = data.rows as unknown as AnyRow[];
  const within30 = allRows.filter((r) => (r.daysUntilExpiry as number) <= 30);
  const within60 = allRows.filter((r) => (r.daysUntilExpiry as number) > 30 && (r.daysUntilExpiry as number) <= 60);
  const within90 = allRows.filter((r) => (r.daysUntilExpiry as number) > 60 && (r.daysUntilExpiry as number) <= 90);

  const filterForm = (
    <form method="GET" className="flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Expiring Within</label>
        <select name="bucket" defaultValue={bucket} className="text-sm rounded-lg border border-gray-300 px-3 py-1.5">
          <option value="30">30 Days</option>
          <option value="60">60 Days</option>
          <option value="90">90 Days</option>
        </select>
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

  const bucketSummary = (
    <div className="mt-4 grid grid-cols-3 gap-4">
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
        <p className="text-2xl font-bold text-red-700">{within30.length}</p>
        <p className="text-sm text-red-600 mt-1">Expiring within 30 days</p>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
        <p className="text-2xl font-bold text-amber-700">{within60.length}</p>
        <p className="text-sm text-amber-600 mt-1">Expiring in 31–60 days</p>
      </div>
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-center">
        <p className="text-2xl font-bold text-blue-700">{within90.length}</p>
        <p className="text-sm text-blue-600 mt-1">Expiring in 61–90 days</p>
      </div>
    </div>
  );

  return (
    <ReportViewer
      reportId="warranty-expiring"
      title="Warranty Expiry Report"
      description={`Serialised products whose warranty expires within the next ${bucket} days as of ${today}.`}
      columns={columns}
      rows={rows}
      totals={{ totalCount: rows.length }}
      totalCount={rows.length}
      generatedAt={new Date().toISOString()}
      generatedBy={actor.name}
      filterSummary={{ asOf: today, location: locationName }}
      filterForm={filterForm}
      queryParams={{ bucket, ...(locationId ? { locationId } : {}) }}
      extraSections={bucketSummary}
    />
  );
}
