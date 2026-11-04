import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import {
  getOutstandingPurchaseOrders,
  getGoodsReceivedSummary,
  getLandedCostAnalysis,
} from '@/server/services/reports/purchasing-report';
import { todayInCompanyTz } from '@/lib/timezone';
import { ReportViewer } from '@/components/reports/ReportViewer';

export const metadata: Metadata = { title: 'Purchasing Report' };

type PurchaseView = 'outstanding' | 'received' | 'landed';

export default async function PurchasingReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const actor = await authorize(PERMISSIONS.PURCHASE_ORDERS_VIEW);
  const params = await searchParams;

  const view: PurchaseView = (params.view as PurchaseView) || 'outstanding';
  const today = todayInCompanyTz();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const from = params.from || thirtyDaysAgo;
  const to = params.to || today;

  type AnyRow = Record<string, any>;
  let rows: AnyRow[] = [];
  let totals: Record<string, unknown> | undefined;

  if (view === 'outstanding') {
    const data = await getOutstandingPurchaseOrders();
    rows = data.rows as unknown as AnyRow[];
    const totalOrdered = data.rows.reduce((sum, r) => sum + r.totalOrderedMinor, 0);
    const totalReceived = data.rows.reduce((sum, r) => sum + r.totalReceivedMinor, 0);
    const totalOutstanding = data.rows.reduce((sum, r) => sum + r.outstandingMinor, 0);
    totals = {
      count: data.rows.length,
      totalOrderedMinor: totalOrdered,
      totalReceivedMinor: totalReceived,
      outstandingMinor: totalOutstanding,
    };
  } else if (view === 'received') {
    const data = await getGoodsReceivedSummary(from, to);
    rows = data.rows as unknown as AnyRow[];
    const totalCost = data.rows.reduce((sum, r) => sum + r.totalCostMinor, 0);
    const totalLanded = data.rows.reduce((sum, r) => sum + r.totalLandedCostMinor, 0);
    totals = {
      count: data.rows.length,
      totalCostMinor: totalCost,
      totalLandedCostMinor: totalLanded,
    };
  } else if (view === 'landed') {
    const data = await getLandedCostAnalysis(from, to);
    rows = data.rows as unknown as AnyRow[];
    const totalGoods = data.rows.reduce((sum, r) => sum + r.productCostMinor, 0);
    const totalFreight = data.rows.reduce((sum, r) => sum + r.freightMinor, 0);
    const totalDuty = data.rows.reduce((sum, r) => sum + r.dutyMinor, 0);
    const totalClearance = data.rows.reduce((sum, r) => sum + r.clearanceMinor, 0);
    const totalOther = data.rows.reduce((sum, r) => sum + r.otherMinor, 0);
    const totalLanded = data.rows.reduce((sum, r) => sum + r.totalLandedMinor, 0);
    totals = {
      productCostMinor: totalGoods,
      freightMinor: totalFreight,
      dutyMinor: totalDuty,
      clearanceMinor: totalClearance,
      otherMinor: totalOther,
      totalLandedMinor: totalLanded,
    };
  }

  const outstandingColumns = [
    { key: 'orderNumber', header: 'PO Number' },
    { key: 'supplierName', header: 'Supplier' },
    { key: 'locationName', header: 'Location' },
    { key: 'orderDate', header: 'Order Date' },
    { key: 'expectedDeliveryDate', header: 'Expected' },
    { key: 'totalOrderedMinor', header: 'Ordered (MWK)', isCurrency: true, align: 'right' as const },
    { key: 'totalReceivedMinor', header: 'Received (MWK)', isCurrency: true, align: 'right' as const },
    { key: 'outstandingMinor', header: 'Outstanding (MWK)', isCurrency: true, align: 'right' as const },
    { key: 'ageInDays', header: 'Age (Days)', isNumber: true, align: 'right' as const },
  ];

  const receivedColumns = [
    { key: 'supplierName', header: 'Supplier' },
    { key: 'receiptCount', header: 'GRN Count', isNumber: true, align: 'right' as const },
    { key: 'totalCostMinor', header: 'Product Cost (MWK)', isCurrency: true, align: 'right' as const },
    { key: 'totalLandedCostMinor', header: 'Total Landed Cost (MWK)', isCurrency: true, align: 'right' as const },
  ];

  const landedColumns = [
    { key: 'receiptNumber', header: 'GRN #' },
    { key: 'supplierName', header: 'Supplier' },
    { key: 'receivedDate', header: 'Received' },
    { key: 'productCostMinor', header: 'Product Cost (MWK)', isCurrency: true, align: 'right' as const },
    { key: 'freightMinor', header: 'Freight (MWK)', isCurrency: true, align: 'right' as const },
    { key: 'dutyMinor', header: 'Duty (MWK)', isCurrency: true, align: 'right' as const },
    { key: 'clearanceMinor', header: 'Clearance (MWK)', isCurrency: true, align: 'right' as const },
    { key: 'otherMinor', header: 'Other (MWK)', isCurrency: true, align: 'right' as const },
    { key: 'totalLandedMinor', header: 'Total Landed (MWK)', isCurrency: true, align: 'right' as const },
  ];

  const columns =
    view === 'outstanding'
      ? outstandingColumns
      : view === 'received'
      ? receivedColumns
      : landedColumns;

  const viewTitles: Record<PurchaseView, string> = {
    outstanding: 'Outstanding Purchase Orders',
    received: 'Goods Received Summary',
    landed: 'Landed Cost Analysis',
  };

  const filterForm = (
    <form method="GET" className="flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">View</label>
        <select name="view" defaultValue={view} className="text-sm rounded-lg border border-gray-300 px-3 py-1.5">
          <option value="outstanding">Outstanding Orders</option>
          <option value="received">Goods Received</option>
          <option value="landed">Landed Cost</option>
        </select>
      </div>
      {view !== 'outstanding' && (
        <>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input type="date" name="from" defaultValue={from} className="text-sm rounded-lg border border-gray-300 px-3 py-1.5" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input type="date" name="to" defaultValue={to} className="text-sm rounded-lg border border-gray-300 px-3 py-1.5" />
          </div>
        </>
      )}
      <button type="submit" className="px-4 py-1.5 text-sm font-medium rounded-lg bg-ace-navy text-white hover:bg-ace-navy/90">
        Run Report
      </button>
    </form>
  );

  return (
    <ReportViewer
      reportId={`purchasing-${view}`}
      title={viewTitles[view]}
      description={
        view === 'outstanding'
          ? 'Purchase orders that have not been fully received, ordered by order date.'
          : view === 'received'
          ? 'Goods received summary grouped by supplier for the selected period.'
          : 'Landed cost breakdown (product cost, freight, duty, clearance, other) per goods receipt note.'
      }
      columns={columns}
      rows={rows}
      totals={totals}
      totalCount={rows.length}
      generatedAt={new Date().toISOString()}
      generatedBy={actor.name}
      filterSummary={{
        period: view !== 'outstanding' ? `${from} – ${to}` : undefined,
      }}
      filterForm={filterForm}
      queryParams={{ view, from, to }}
    />
  );
}
