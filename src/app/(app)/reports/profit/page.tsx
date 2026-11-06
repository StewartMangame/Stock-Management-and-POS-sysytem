import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getProfitByItem } from '@/server/services/reports/profit-report';
import { getLocations } from '@/server/services/locations';
import { todayInCompanyTz } from '@/lib/timezone';
import { ReportViewer } from '@/components/reports/ReportViewer';
import { formatTambala } from '@/lib/money';

export const metadata: Metadata = { title: 'Profit Report' };

const ACCOUNTING_RULE =
  'Accounting Rule: Revenue is recognized at delivery; cost of sales is recorded from ' +
  'delivery note unit costs. Customer returns reverse both revenue and cost at the ' +
  'original cost of goods sold. Rounding remainder applied to the final delivery line.';

export default async function ProfitReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; locationId?: string }>;
}) {
  const actor = await authorize(PERMISSIONS.REPORTS_COST);
  const params = await searchParams;

  const today = todayInCompanyTz();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const from = params.from || thirtyDaysAgo;
  const to = params.to || today;
  const locationId = params.locationId || undefined;

  const locations = await getLocations();
  const locationName = locationId
    ? (locations.find((l) => l.id === locationId)?.name ?? locationId)
    : 'All Locations';

  const data = await getProfitByItem({ from, to, locationId });

  const columns = [
    { key: 'productName', header: 'Product' },
    { key: 'sku', header: 'SKU' },
    { key: 'categoryName', header: 'Category' },
    { key: 'deliveredQty', header: 'Delivered Qty', isNumber: true },
    { key: 'revenueMinor', header: 'Revenue (MWK)', isCurrency: true, align: 'right' as const },
    { key: 'costMinor', header: 'Cost (MWK)', isCurrency: true, align: 'right' as const },
    { key: 'grossProfitMinor', header: 'Gross Profit (MWK)', isCurrency: true, align: 'right' as const },
    { key: 'marginPct', header: 'Margin %', align: 'right' as const },
  ];

  const totals = {
    revenueMinor: data.totals.totalRevenueMinor,
    costMinor: data.totals.totalCostMinor,
    grossProfitMinor: data.totals.grossProfitMinor,
    marginPct: data.totals.overallMarginPct,
  };

  const filterForm = (
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
  );

  // "Invoiced, Not Yet Delivered" extra section
  const invoicedNotDelivered = data.invoicedNotDelivered;

  const extraSections = invoicedNotDelivered.length > 0 ? (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mt-4">
      <h3 className="text-sm font-semibold text-amber-900 mb-3">
        Invoiced, Not Yet Delivered — {formatTambala(data.totals.invoicedNotDeliveredMinor)} pending revenue
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-amber-700 font-semibold">
              <th className="px-3 py-2 text-left">Invoice #</th>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-left">Product</th>
              <th className="px-3 py-2 text-left">Issue Date</th>
              <th className="px-3 py-2 text-right">Invoiced</th>
              <th className="px-3 py-2 text-right">Delivered</th>
              <th className="px-3 py-2 text-right">Pending</th>
              <th className="px-3 py-2 text-right">Pending Revenue</th>
            </tr>
          </thead>
          <tbody>
            {invoicedNotDelivered.map((r, i) => (
              <tr key={i} className="border-t border-amber-200">
                <td className="px-3 py-2 text-amber-800">{r.invoiceNumber}</td>
                <td className="px-3 py-2 text-amber-800">{r.customerName}</td>
                <td className="px-3 py-2 text-amber-800">{r.productName}</td>
                <td className="px-3 py-2 text-amber-800">{r.issueDate}</td>
                <td className="px-3 py-2 text-right text-amber-800">{r.invoicedQty}</td>
                <td className="px-3 py-2 text-right text-amber-800">{r.deliveredQty}</td>
                <td className="px-3 py-2 text-right text-amber-800">{r.pendingQty}</td>
                <td className="px-3 py-2 text-right font-medium text-amber-900">{formatTambala(r.pendingRevenueMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  ) : null;

  return (
    <ReportViewer
      reportId="profit-by-item"
      title="Profit Report"
      description="Gross profit by product at delivery. Revenue recognized at delivery, cost from delivery note unit costs."
      columns={columns}
      rows={data.rows as unknown as Record<string, any>[]}
      totals={totals}
      totalCount={data.rows.length}
      generatedAt={new Date().toISOString()}
      generatedBy={actor.name}
      filterSummary={{
        period: `${from} – ${to}`,
        location: locationName,
      }}
      filterForm={filterForm}
      disclaimer={ACCOUNTING_RULE}
      extraSections={extraSections}
      queryParams={{ from, to, ...(locationId ? { locationId } : {}) }}
    />
  );
}

