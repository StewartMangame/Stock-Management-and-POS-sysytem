import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getControlsReport } from '@/server/services/reports/controls-report';
import { getLocations } from '@/server/services/locations';
import { todayInCompanyTz } from '@/lib/timezone';
import { ReportViewer } from '@/components/reports/ReportViewer';

export const metadata: Metadata = { title: 'Controls Report' };

export default async function ControlsReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    locationId?: string;
    type?: string;
  }>;
}) {
  // Manager/admin only — requires REPORTS_COST permission
  const actor = await authorize(PERMISSIONS.REPORTS_COST);
  const params = await searchParams;

  const today = todayInCompanyTz();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const from = params.from || thirtyDaysAgo;
  const to = params.to || today;
  const locationId = params.locationId || undefined;
  const filterType = params.type || 'all';

  const locations = await getLocations();
  const locationName = locationId
    ? (locations.find((l) => l.id === locationId)?.name ?? locationId)
    : 'All Locations';

  // Service signature: getControlsReport(from, to, locationId?)
  const data = await getControlsReport(from, to, locationId);

  type AnyRow = Record<string, unknown>;

  // Action-to-type mapping (matches CONTROLS_ACTIONS in the service)
  const ACTION_TYPE_MAP: Record<string, string> = {
    'invoice.void': 'voids',
    'payment.refund': 'refunds',
    'payment.reverse': 'reversals',
    'stock.adjustment': 'stock_adjustments',
    'pos.override': 'overrides',
    'pos.reprint': 'reprints',
    'sale.below_cost': 'below_cost',
    'discount.above_limit': 'discounts',
  };

  // Filter by type on the client after the query
  let rows: AnyRow[] = data.rows.map((r) => ({
    occurredAt: r.at,
    exceptionType: r.action.replace('.', ': '),
    actorName: r.actorName,
    approverName: (r.details as Record<string, unknown>)?.approverName ?? '—',
    entityType: r.entityType,
    entityRef: r.entityId ?? '—',
    amountMinor: (r.details as Record<string, unknown>)?.amountMinor ?? null,
    detail: JSON.stringify(r.details ?? {}),
  }));

  if (filterType !== 'all') {
    const targetAction = Object.entries(ACTION_TYPE_MAP).find(([, v]) => v === filterType)?.[0];
    if (targetAction) {
      rows = rows.filter((r) => (r.exceptionType as string).startsWith(targetAction.replace('.', ': ')));
    }
  }

  // Build type counts from raw data
  const typeCounts: Record<string, number> = {
    voids: data.totals.totalVoids,
    refunds: data.totals.totalRefunds,
    reversals: data.totals.totalReversals,
    adjustments: data.totals.totalAdjustments,
    overrides: data.totals.totalOverrides,
    reprints: data.totals.totalReprints,
    below_cost: data.totals.totalBelowCost,
    discounts: data.totals.totalDiscountExceptions,
  };

  const columns = [
    { key: 'occurredAt', header: 'Date/Time' },
    { key: 'exceptionType', header: 'Type' },
    { key: 'actorName', header: 'Performed By' },
    { key: 'approverName', header: 'Approver' },
    { key: 'entityType', header: 'Record' },
    { key: 'entityRef', header: 'Reference' },
    { key: 'amountMinor', header: 'Amount (MWK)', isCurrency: true, align: 'right' as const },
    { key: 'detail', header: 'Details' },
  ];

  const summarySection = (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Exception Summary</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(typeCounts).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
            <p className="text-xl font-bold text-ace-navy">{v}</p>
            <p className="text-xs text-gray-500 mt-0.5 capitalize">{k.replace(/_/g, ' ')}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-500">
        This report reads from the audit log. For full detail, open the{' '}
        <a href="/admin/audit-log" className="text-ace-sky underline">Audit Log</a>.
      </p>
    </div>
  );

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
        <label className="block text-xs font-medium text-gray-500 mb-1">Exception Type</label>
        <select name="type" defaultValue={filterType} className="text-sm rounded-lg border border-gray-300 px-3 py-1.5">
          <option value="all">All Exceptions</option>
          <option value="discounts">Discounts Above Limit</option>
          <option value="below_cost">Sales Below Cost</option>
          <option value="voids">Voids</option>
          <option value="refunds">Refunds</option>
          <option value="stock_adjustments">Stock Adjustments</option>
          <option value="reversals">Reversals</option>
          <option value="reprints">Receipt Reprints</option>
          <option value="overrides">Manager Overrides</option>
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
      reportId="controls-exceptions"
      title="Controls Exception Register"
      description="Flagged business events: discounts above threshold, sales below cost, voids, refunds, stock adjustments, reversals, receipt reprints and manager overrides. Manager and Admin only."
      columns={columns}
      rows={rows}
      totals={{ totalExceptions: rows.length }}
      totalCount={rows.length}
      generatedAt={new Date().toISOString()}
      generatedBy={actor.name}
      filterSummary={{ period: `${from} – ${to}`, location: locationName }}
      filterForm={filterForm}
      queryParams={{ from, to, type: filterType, ...(locationId ? { locationId } : {}) }}
      extraSections={summarySection}
    />
  );
}
