import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getSalesByItem, getSalesByCustomer, getSalesByDay, getSalesByPaymentMethod } from '@/server/services/reports/sales-report';
import { getLocations } from '@/server/services/locations';
import { todayInCompanyTz } from '@/lib/timezone';
import { ReportViewer } from '@/components/reports/ReportViewer';

export const metadata: Metadata = { title: 'Sales Report' };

export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; locationId?: string; groupBy?: string }>;
}) {
  const actor = await authorize(PERMISSIONS.REPORTS_VIEW);
  const params = await searchParams;

  const today = todayInCompanyTz();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const from = params.from || thirtyDaysAgo;
  const to = params.to || today;
  const locationId = params.locationId || undefined;
  const groupBy = (params.groupBy as 'item' | 'customer' | 'day' | 'payment_method') || 'day';

  const locations = await getLocations();
  const locationName = locationId
    ? (locations.find((l) => l.id === locationId)?.name ?? locationId)
    : 'All Locations';

  const hasCost = (actor.role.permissions as string[]).includes(PERMISSIONS.REPORTS_COST);

  let rows: Record<string, any>[] = [];
  let totals: Record<string, unknown> | undefined;

  const reportParams = { from, to, locationId, groupBy };

  if (groupBy === 'item') {
    const data = await getSalesByItem(reportParams);
    rows = data.rows as unknown as Record<string, any>[];
    totals = {
      revenueMinor: data.totals.netRevenueMinor,
      ...(hasCost ? { costMinor: data.totals.totalCostMinor, marginMinor: data.totals.totalMarginMinor } : {}),
    };
  } else if (groupBy === 'customer') {
    const data = await getSalesByCustomer(reportParams);
    rows = data.rows as unknown as Record<string, any>[];
    totals = { revenueMinor: data.totals.netRevenueMinor };
  } else if (groupBy === 'day') {
    const data = await getSalesByDay(reportParams);
    rows = data.rows as unknown as Record<string, any>[];
    totals = {
      grossMinor: data.totals.grossRevenueMinor,
      creditMinor: data.totals.totalCreditMinor,
      netRevenueMinor: data.totals.netRevenueMinor,
    };
  } else if (groupBy === 'payment_method') {
    const data = await getSalesByPaymentMethod(reportParams);
    rows = data.rows as unknown as Record<string, any>[];
    totals = { amountMinor: data.totals.netRevenueMinor };
  }

  // Columns per groupBy
  const columns =
    groupBy === 'item'
      ? [
          { key: 'productName', header: 'Product' },
          { key: 'sku', header: 'SKU' },
          { key: 'categoryName', header: 'Category' },
          { key: 'quantitySold', header: 'Qty Sold', isNumber: true },
          { key: 'revenueMinor', header: 'Revenue (MWK)', isCurrency: true, align: 'right' as const },
          ...(hasCost ? [
            { key: 'costMinor', header: 'Cost (MWK)', isCurrency: true, align: 'right' as const },
            { key: 'marginMinor', header: 'Margin (MWK)', isCurrency: true, align: 'right' as const },
            { key: 'marginPct', header: 'Margin %', align: 'right' as const },
          ] : []),
        ]
      : groupBy === 'customer'
      ? [
          { key: 'accountNumber', header: 'Account #' },
          { key: 'customerName', header: 'Customer' },
          { key: 'invoiceCount', header: 'Invoices', isNumber: true },
          { key: 'revenueMinor', header: 'Revenue (MWK)', isCurrency: true, align: 'right' as const },
        ]
      : groupBy === 'day'
      ? [
          { key: 'date', header: 'Date' },
          { key: 'invoiceCount', header: 'Invoices', isNumber: true },
          { key: 'creditNoteCount', header: 'Credit Notes', isNumber: true },
          { key: 'grossMinor', header: 'Gross Revenue (MWK)', isCurrency: true, align: 'right' as const },
          { key: 'creditMinor', header: 'Credits (MWK)', isCurrency: true, align: 'right' as const },
          { key: 'netRevenueMinor', header: 'Net Revenue (MWK)', isCurrency: true, align: 'right' as const },
        ]
      : [
          { key: 'method', header: 'Payment Method' },
          { key: 'count', header: 'Count', isNumber: true },
          { key: 'amountMinor', header: 'Amount (MWK)', isCurrency: true, align: 'right' as const },
        ];

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
        <label className="block text-xs font-medium text-gray-500 mb-1">Group By</label>
        <select name="groupBy" defaultValue={groupBy} className="text-sm rounded-lg border border-gray-300 px-3 py-1.5">
          <option value="day">By Day</option>
          <option value="item">By Item</option>
          <option value="customer">By Customer</option>
          <option value="payment_method">By Payment Method</option>
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

  return (
    <ReportViewer
      reportId={`sales-by-${groupBy === 'payment_method' ? 'payment-method' : groupBy}`}
      title="Sales Report"
      description="Revenue from issued invoices minus credit notes, excluding tax."
      columns={columns}
      rows={rows}
      totals={totals}
      totalCount={rows.length}
      generatedAt={new Date().toISOString()}
      generatedBy={actor.name}
      filterSummary={{
        period: `${from} – ${to}`,
        location: locationName,
      }}
      filterForm={filterForm}
      queryParams={{ from, to, ...(locationId ? { locationId } : {}), groupBy }}
    />
  );
}

