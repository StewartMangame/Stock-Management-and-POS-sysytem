import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import {
  getStockOnHand,
  getStockValuationAsOf,
  getLowStockReport,
  getSlowMovingStock,
} from '@/server/services/reports/stock-report';
import { getLocations } from '@/server/services/locations';
import { todayInCompanyTz } from '@/lib/timezone';
import { ReportViewer } from '@/components/reports/ReportViewer';

export const metadata: Metadata = { title: 'Stock Report' };

type StockView = 'onhand' | 'valuation' | 'low' | 'slow';

export default async function StockReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    locationId?: string;
    asOf?: string;
    slowDays?: string;
  }>;
}) {
  const actor = await authorize(PERMISSIONS.STOCK_VIEW);
  const params = await searchParams;

  const view: StockView = (params.view as StockView) || 'onhand';
  const locationId = params.locationId || undefined;
  const today = todayInCompanyTz();
  const asOf = params.asOf || today;
  const slowDays = parseInt(params.slowDays || '90', 10);

  const locations = await getLocations();
  const locationName = locationId
    ? (locations.find((l) => l.id === locationId)?.name ?? locationId)
    : 'All Locations';

  const hasCost = (actor.role.permissions as string[]).includes(PERMISSIONS.REPORTS_COST);

  // ── Query ─────────────────────────────────────────────────────────────────
  type AnyRow = Record<string, any>;
  let rows: AnyRow[] = [];
  let totals: Record<string, unknown> | undefined;

  if (view === 'onhand') {
    const data = await getStockOnHand(locationId);
    rows = data.rows.map((r) => ({
      productName: r.productName,
      sku: r.sku,
      categoryName: r.categoryName,
      locationName: r.locationName,
      onHand: r.onHand,
      reserved: r.reserved,
      available: r.available,
      ...(hasCost ? { avgCostMinor: r.avgCostMinor, valuationMinor: r.valuationMinor } : {}),
      reorderLevel: r.reorderLevel,
    }));
    if (hasCost) {
      const totalVal = rows.reduce((s, r) => s + ((r.valuationMinor as number) ?? 0), 0);
      totals = { totalValuationMinor: totalVal };
    }
  } else if (view === 'valuation') {
    const data = await getStockValuationAsOf(asOf, locationId);
    rows = data.rows.map((r) => ({
      productName: r.productName,
      sku: r.sku,
      locationName: r.locationName,
      onHandAsOf: r.onHandAsOf,
      ...(hasCost ? { avgCostMinor: r.avgCostMinor, valuationMinor: r.valuationMinor } : {}),
      snapshotSource: r.snapshotSource,
    }));
    if (hasCost) {
      totals = { totalValuationMinor: data.totals.totalValuationMinor };
    }
  } else if (view === 'low') {
    const data = await getLowStockReport(locationId);
    rows = data.rows as unknown as AnyRow[];
    totals = { count: data.rows.length };
  } else if (view === 'slow') {
    const data = await getSlowMovingStock(slowDays, locationId);
    rows = data.rows as unknown as AnyRow[];
    totals = { count: data.rows.length };
  }

  // ── Columns ───────────────────────────────────────────────────────────────
  const onHandColumns = [
    { key: 'productName', header: 'Product' },
    { key: 'sku', header: 'SKU' },
    { key: 'categoryName', header: 'Category' },
    { key: 'locationName', header: 'Location' },
    { key: 'onHand', header: 'On Hand', isNumber: true, align: 'right' as const },
    { key: 'reserved', header: 'Reserved', isNumber: true, align: 'right' as const },
    { key: 'available', header: 'Available', isNumber: true, align: 'right' as const },
    ...(hasCost
      ? [
          { key: 'avgCostMinor', header: 'Avg Cost (MWK)', isCurrency: true, align: 'right' as const },
          { key: 'valuationMinor', header: 'Valuation (MWK)', isCurrency: true, align: 'right' as const },
        ]
      : []),
    { key: 'reorderLevel', header: 'Reorder Level', isNumber: true, align: 'right' as const },
  ];

  const valuationColumns = [
    { key: 'productName', header: 'Product' },
    { key: 'sku', header: 'SKU' },
    { key: 'locationName', header: 'Location' },
    { key: 'onHandAsOf', header: 'On Hand As Of', isNumber: true, align: 'right' as const },
    ...(hasCost
      ? [
          { key: 'avgCostMinor', header: 'Avg Cost (MWK)', isCurrency: true, align: 'right' as const },
          { key: 'valuationMinor', header: 'Valuation (MWK)', isCurrency: true, align: 'right' as const },
        ]
      : []),
    { key: 'snapshotSource', header: 'Source' },
  ];

  const lowStockColumns = [
    { key: 'productName', header: 'Product' },
    { key: 'sku', header: 'SKU' },
    { key: 'locationName', header: 'Location' },
    { key: 'onHand', header: 'On Hand', isNumber: true, align: 'right' as const },
    { key: 'reserved', header: 'Reserved', isNumber: true, align: 'right' as const },
    { key: 'available', header: 'Available', isNumber: true, align: 'right' as const },
    { key: 'reorderLevel', header: 'Reorder Level', isNumber: true, align: 'right' as const },
  ];

  const slowMovingColumns = [
    { key: 'productName', header: 'Product' },
    { key: 'sku', header: 'SKU' },
    { key: 'locationName', header: 'Location' },
    { key: 'onHand', header: 'On Hand', isNumber: true, align: 'right' as const },
    { key: 'lastSaleDate', header: 'Last Sale' },
    { key: 'daysSinceLastSale', header: 'Days Idle', isNumber: true, align: 'right' as const },
  ];

  const columns =
    view === 'onhand'
      ? onHandColumns
      : view === 'valuation'
      ? valuationColumns
      : view === 'low'
      ? lowStockColumns
      : slowMovingColumns;

  const viewTitles: Record<StockView, string> = {
    onhand: 'Stock On Hand',
    valuation: `Stock Valuation as of ${asOf}`,
    low: 'Low Stock & Reorder Suggestions',
    slow: `Slow-Moving Stock (no sales in ${slowDays} days)`,
  };

  const filterForm = (
    <form method="GET" className="flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">View</label>
        <select name="view" defaultValue={view} className="text-sm rounded-lg border border-gray-300 px-3 py-1.5">
          <option value="onhand">On Hand</option>
          <option value="valuation">Valuation (As Of Date)</option>
          <option value="low">Low Stock</option>
          <option value="slow">Slow Moving</option>
        </select>
      </div>
      {view === 'valuation' && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">As Of Date</label>
          <input type="date" name="asOf" defaultValue={asOf} max={today} className="text-sm rounded-lg border border-gray-300 px-3 py-1.5" />
        </div>
      )}
      {view === 'slow' && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Days Without Sales</label>
          <input type="number" name="slowDays" defaultValue={slowDays} min={1} max={730} className="text-sm rounded-lg border border-gray-300 px-3 py-1.5 w-24" />
        </div>
      )}
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
      reportId={`stock-${view}`}
      title={viewTitles[view]}
      description={
        view === 'onhand'
          ? 'Current stock levels by product and location.'
          : view === 'valuation'
          ? `Stock valuation replayed from the ledger as of end-of-day ${asOf} (Africa/Blantyre). Historical values do not change when new movements are recorded.`
          : view === 'low'
          ? 'Products at or below their reorder level.'
          : `Products with no sales activity in the past ${slowDays} days.`
      }
      columns={columns}
      rows={rows}
      totals={totals}
      totalCount={rows.length}
      generatedAt={new Date().toISOString()}
      generatedBy={actor.name}
      filterSummary={{
        asOf: view === 'valuation' ? asOf : undefined,
        location: locationName,
      }}
      filterForm={filterForm}
      queryParams={{ view, ...(locationId ? { locationId } : {}), asOf, slowDays: String(slowDays) }}
    />
  );
}
