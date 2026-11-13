import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { buildCsv, hasCostAccess, stripCostColumns, stripCostTotals } from '@/lib/report-framework';
import type { ReportUser } from '@/lib/report-framework';
import { writeAuditLog } from '@/server/services/audit';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Report data imports ───────────────────────────────────────────────────────
import { getSalesByItem, getSalesByCustomer, getSalesByDay, getSalesByPaymentMethod } from '@/server/services/reports/sales-report';
import { getProfitByItem } from '@/server/services/reports/profit-report';
import { getVatSummary } from '@/server/services/reports/vat-report';
import { getStockOnHand, getStockValuationAsOf, getLowStockReport, getSlowMovingStock } from '@/server/services/reports/stock-report';
import { getOutstandingPurchaseOrders, getGoodsReceivedSummary, getLandedCostAnalysis } from '@/server/services/reports/purchasing-report';
import { getWarrantyExpiring, getSalesPipeline } from '@/server/services/reports/warranty-pipeline-report';
import { getControlsReport } from '@/server/services/reports/controls-report';
import { getAgedDebtors } from '@/server/services/reports/aged-debtors';
import { getPaymentsReport } from '@/server/services/reports/payments-report';

// Permission map: report slug → required permission
const REPORT_PERMISSIONS: Record<string, string> = {
  'sales-by-item':           PERMISSIONS.REPORTS_VIEW,
  'sales-by-customer':       PERMISSIONS.REPORTS_VIEW,
  'sales-by-day':            PERMISSIONS.REPORTS_VIEW,
  'sales-by-payment-method': PERMISSIONS.REPORTS_VIEW,
  'profit-by-item':          PERMISSIONS.REPORTS_COST,
  'vat-summary':             PERMISSIONS.REPORTS_COST,
  'stock-on-hand':           PERMISSIONS.STOCK_VIEW,
  'stock-valuation':         PERMISSIONS.STOCK_VIEW,
  'low-stock':               PERMISSIONS.STOCK_VIEW,
  'slow-moving-stock':       PERMISSIONS.STOCK_VIEW,
  'purchasing-outstanding':  PERMISSIONS.PURCHASE_ORDERS_VIEW,
  'purchasing-received':     PERMISSIONS.PURCHASE_ORDERS_VIEW,
  'purchasing-landed-cost':  PERMISSIONS.PURCHASE_ORDERS_VIEW,
  'warranty-expiring':       PERMISSIONS.REPORTS_VIEW,
  'sales-pipeline':          PERMISSIONS.REPORTS_VIEW,
  'controls':                PERMISSIONS.REPORTS_COST,
  'aged-debtors':            PERMISSIONS.REPORTS_VIEW,
  'payments-received':       PERMISSIONS.PAYMENTS_VIEW,
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ report: string }> },
) {
  try {
    const { report } = await params;
    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'json'; // 'json' | 'csv'

    const requiredPerm = Object.prototype.hasOwnProperty.call(REPORT_PERMISSIONS, report)
      ? REPORT_PERMISSIONS[report]
      : undefined;
    if (!requiredPerm) {
      return NextResponse.json({ error: 'Unknown report' }, { status: 404 });
    }

    const actor = await authorize(requiredPerm as Parameters<typeof authorize>[0]);
    const user: ReportUser = {
      id: actor.id,
      name: actor.name,
      permissions: actor.role.permissions as string[],
    };

    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const asOf = url.searchParams.get('asOf') || '';
    const locationId = url.searchParams.get('locationId') || undefined;
    const groupBy = url.searchParams.get('groupBy') || 'item';
    const days = parseInt(url.searchParams.get('days') || '60', 10);

    // ── Run the query ──────────────────────────────────────────────────────────
    let data: unknown;

    switch (report) {
      case 'sales-by-item':
        data = await getSalesByItem({ from, to, locationId, groupBy: 'item' });
        break;
      case 'sales-by-customer':
        data = await getSalesByCustomer({ from, to, locationId, groupBy: 'customer' });
        break;
      case 'sales-by-day':
        data = await getSalesByDay({ from, to, locationId, groupBy: 'day' });
        break;
      case 'sales-by-payment-method':
        data = await getSalesByPaymentMethod({ from, to, locationId, groupBy: 'payment_method' });
        break;
      case 'profit-by-item': {
        const profit = await getProfitByItem({ from, to, locationId });
        // Strip cost for non-cost roles before response
        if (!hasCostAccess(user)) {
          profit.rows = profit.rows.map((r) => {
            const { costMinor: _c, grossProfitMinor: _g, marginPct: _m, ...safe } = r;
            return safe as typeof r;
          });
          profit.totals.totalCostMinor = 0;
          profit.totals.grossProfitMinor = 0;
          profit.totals.overallMarginPct = 0;
        }
        data = profit;
        break;
      }
      case 'vat-summary':
        data = await getVatSummary(from, to, locationId);
        break;
      case 'stock-on-hand':
        data = await getStockOnHand(locationId);
        break;
      case 'stock-valuation':
        data = await getStockValuationAsOf(asOf, locationId);
        break;
      case 'low-stock':
        data = await getLowStockReport(locationId);
        break;
      case 'slow-moving-stock':
        data = await getSlowMovingStock(days, locationId);
        break;
      case 'purchasing-outstanding':
        data = await getOutstandingPurchaseOrders();
        break;
      case 'purchasing-received':
        data = await getGoodsReceivedSummary(from, to);
        break;
      case 'purchasing-landed-cost':
        data = await getLandedCostAnalysis(from, to);
        break;
      case 'warranty-expiring':
        data = await getWarrantyExpiring(locationId);
        break;
      case 'sales-pipeline':
        data = await getSalesPipeline(locationId);
        break;
      case 'controls':
        data = await getControlsReport(from, to, locationId);
        break;
      case 'aged-debtors': {
        const ad = await getAgedDebtors(asOf, locationId);
        data = ad;
        break;
      }
      case 'payments-received': {
        const pr = await getPaymentsReport(from, to, locationId);
        data = pr;
        break;
      }
      default:
        return NextResponse.json({ error: 'Unknown report' }, { status: 404 });
    }

    // ── CSV export: audit log + stream ────────────────────────────────────────
    if (format === 'csv') {
      await writeAuditLog(db, {
        userId: actor.id,
        action: 'report.export',
        entityType: 'report',
        entityId: null,
        after: { report, format: 'csv', from, to, asOf, locationId },
      });

      const csvContent = buildReportCsv(report, data, user);
      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${report}_${from || asOf || 'export'}.csv"`,
        },
      });
    }

    return NextResponse.json({ ok: true, data, generatedAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: err.code === 'UNAUTHENTICATED' ? 401 : 403 });
    }
    console.error('Report API error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── CSV builder per report ─────────────────────────────────────────────────────

function buildReportCsv(report: string, data: unknown, user: ReportUser): string {
  const BOM = '\uFEFF';
  const hasCost = hasCostAccess(user);

  function cell(v: unknown): string {
    if (v === null || v === undefined) return '';
    const s = String(v);
    const formulaChars = ['=', '+', '-', '@', '\t', '\r'];
    if (formulaChars.some((c) => s.startsWith(c))) return `'${s}`;
    if (s.includes(',') || s.includes('\n') || s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function row(values: unknown[]): string {
    return values.map(cell).join(',');
  }

  function formatMWK(minor: number): string {
    return (minor / 100).toFixed(2);
  }

  const d = data as Record<string, unknown>;

  switch (report) {
    case 'sales-by-item': {
      const rows = (d.rows as Array<Record<string, unknown>>);
      const headers = ['Product', 'SKU', 'Category', 'Qty Sold', 'Revenue (MWK)',
        ...(hasCost ? ['Cost (MWK)', 'Margin (MWK)', 'Margin %'] : [])];
      const lines = rows.map((r) => row([
        r.productName, r.sku, r.categoryName, r.quantitySold,
        formatMWK(r.revenueMinor as number),
        ...(hasCost ? [formatMWK(r.costMinor as number), formatMWK(r.marginMinor as number), r.marginPct] : []),
      ]));
      return BOM + [row(headers), ...lines].join('\r\n');
    }
    case 'sales-by-customer': {
      const rows = (d.rows as Array<Record<string, unknown>>);
      const headers = ['Account #', 'Customer', 'Invoice Count', 'Revenue (MWK)'];
      const lines = rows.map((r) => row([r.accountNumber, r.customerName, r.invoiceCount, formatMWK(r.revenueMinor as number)]));
      return BOM + [row(headers), ...lines].join('\r\n');
    }
    case 'sales-by-day': {
      const rows = (d.rows as Array<Record<string, unknown>>);
      const headers = ['Date', 'Invoices', 'Credit Notes', 'Gross Revenue (MWK)', 'Credits (MWK)', 'Net Revenue (MWK)'];
      const lines = rows.map((r) => row([r.date, r.invoiceCount, r.creditNoteCount,
        formatMWK(r.grossMinor as number), formatMWK(r.creditMinor as number), formatMWK(r.netRevenueMinor as number)]));
      return BOM + [row(headers), ...lines].join('\r\n');
    }
    case 'profit-by-item': {
      const rows = (d.rows as Array<Record<string, unknown>>);
      const headers = ['Product', 'SKU', 'Category', 'Delivered Qty', 'Revenue (MWK)',
        ...(hasCost ? ['Cost (MWK)', 'Gross Profit (MWK)', 'Margin %'] : [])];
      const lines = rows.map((r) => row([
        r.productName, r.sku, r.categoryName, r.deliveredQty,
        formatMWK(r.revenueMinor as number),
        ...(hasCost ? [formatMWK(r.costMinor as number), formatMWK(r.grossProfitMinor as number), r.marginPct] : []),
      ]));
      return BOM + [row(headers), ...lines].join('\r\n');
    }
    case 'vat-summary': {
      const rows = (d.rows as Array<Record<string, unknown>>);
      const headers = ['VAT Rate', 'Rate %', 'Taxable Sales (MWK)', 'Output VAT (MWK)',
        'Taxable Credits (MWK)', 'Credit VAT (MWK)', 'Net Taxable (MWK)', 'Net VAT (MWK)'];
      const lines = rows.map((r) => row([r.rateName, r.ratePercent,
        formatMWK(r.taxableSalesMinor as number), formatMWK(r.outputVatMinor as number),
        formatMWK(r.taxableCreditMinor as number), formatMWK(r.creditVatMinor as number),
        formatMWK(r.netTaxableMinor as number), formatMWK(r.netVatMinor as number)]));
      return BOM + [row(headers), '*** OUTPUT VAT ONLY — Purchase VAT not tracked ***', ...lines].join('\r\n');
    }
    case 'stock-on-hand': {
      const rows = (d.rows as Array<Record<string, unknown>>);
      const headers = ['Product', 'SKU', 'Category', 'Location', 'On Hand', 'Reserved', 'Available',
        ...(hasCost ? ['Avg Cost (MWK)', 'Valuation (MWK)'] : [])];
      const lines = rows.map((r) => row([
        r.productName, r.sku, r.categoryName, r.locationName,
        r.onHand, r.reserved, r.available,
        ...(hasCost ? [formatMWK(r.avgCostMinor as number), formatMWK(r.valuationMinor as number)] : []),
      ]));
      return BOM + [row(headers), ...lines].join('\r\n');
    }
    case 'aged-debtors': {
      const rows = (Array.isArray(data) ? data : (d.rows as Array<Record<string, unknown>>) || []) as Array<Record<string, unknown>>;
      const headers = ['Account #', 'Customer', 'Current', '1-30 Days', '31-60 Days', '61-90 Days', '90+ Days', 'Total Outstanding (MWK)'];
      const lines = rows.map((r) => row([
        r.accountNumber, r.customerName,
        formatMWK(r.currentMinor as number), formatMWK(r.days1_30Minor as number),
        formatMWK(r.days31_60Minor as number), formatMWK(r.days61_90Minor as number),
        formatMWK(r.days90plusMinor as number), formatMWK(r.totalOutstandingMinor as number),
      ]));
      return BOM + [row(headers), ...lines].join('\r\n');
    }
    default: {
      return BOM + 'Report\r\n' + JSON.stringify(data);
    }
  }
}

