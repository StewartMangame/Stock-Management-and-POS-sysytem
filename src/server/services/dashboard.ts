/**
 * Role-Based Dashboard Data Service (Phase 6).
 *
 * Implements Blantyre "today" metrics strictly aligned with Report Definitions:
 * - Manager / Admin: sales today (office & counter), AR, low stock, unreconciled, EIS, quotes, shifts, exceptions
 * - Sales: own quotations & invoices, pipeline value
 * - Storekeeper: low stock, invoices awaiting delivery, POs to receive
 * - Cashier: own shift only (NO cash figures, NO expected cash, NO targets)
 * - Viewer: sales & stock summary without cost
 *
 * Every figure matches the corresponding report service.
 */

import { db } from '@/server/db';
import { sql } from 'drizzle-orm';
import { startOfDayInCompanyTz, todayInCompanyTz } from '@/lib/timezone';

function nextDayStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00+02:00');
  d.setDate(d.getDate() + 1);
  return d;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ManagerDashboardData {
  salesToday: {
    totalNetMinor: number;
    officeNetMinor: number;
    counterNetMinor: number;
    invoiceCount: number;
  };
  receivables: {
    outstandingMinor: number;
    overdueMinor: number;
    overdueCount: number;
  };
  lowStockCount: number;
  unreconciledPayments: {
    count: number;
    totalMinor: number;
  };
  pendingEisCount: number;
  openQuotations: {
    count: number;
    totalMinor: number;
  };
  openShifts: {
    openCount: number;
    latestVarianceMinor: number | null;
  };
  exceptionsCount: number;
}

export interface SalesDashboardData {
  ownQuotations: {
    count: number;
    totalMinor: number;
  };
  ownInvoicesToday: {
    count: number;
    totalMinor: number;
  };
  pipelineValueMinor: number;
}

export interface StorekeeperDashboardData {
  lowStockCount: number;
  invoicesAwaitingDelivery: number;
  purchaseOrdersToReceive: number;
}

export interface CashierDashboardData {
  currentShift: {
    id: string;
    shiftNumber: string;
    openedAt: string;
    status: string;
  } | null;
  salesCountToday: number;
  itemsSoldToday: number;
  // NOTE: Cashier dashboard strictly hides openingFloat, countedCash, expectedCash, and sales targets
}

export interface ViewerDashboardData {
  salesTodayNetMinor: number;
  activeProductsCount: number;
  totalUnitsOnHand: number;
}

// ── Service Functions ─────────────────────────────────────────────────────────

export async function getManagerDashboardData(locationId?: string): Promise<ManagerDashboardData> {
  const today = todayInCompanyTz();
  const fromInstant = startOfDayInCompanyTz(today);
  const toInstant = nextDayStart(today);

  const locFilter = locationId
    ? sql`AND sd.location_id = ${locationId}::uuid`
    : sql``;

  // 1. Sales today (matches getSalesByDay)
  const salesRes = await db.execute<{
    office_gross: string;
    office_credit: string;
    counter_gross: string;
    counter_credit: string;
    inv_count: string;
  }>(sql`
    SELECT
      COALESCE(SUM(CASE WHEN sd.document_type = 'invoice' AND COALESCE(sd.channel, 'office') != 'counter' THEN (sd.total_minor - sd.tax_minor) ELSE 0 END), 0)::text AS office_gross,
      COALESCE(SUM(CASE WHEN sd.document_type = 'credit_note' AND COALESCE(sd.channel, 'office') != 'counter' THEN (sd.total_minor - sd.tax_minor) ELSE 0 END), 0)::text AS office_credit,
      COALESCE(SUM(CASE WHEN sd.document_type = 'invoice' AND sd.channel = 'counter' THEN (sd.total_minor - sd.tax_minor) ELSE 0 END), 0)::text AS counter_gross,
      COALESCE(SUM(CASE WHEN sd.document_type = 'credit_note' AND sd.channel = 'counter' THEN (sd.total_minor - sd.tax_minor) ELSE 0 END), 0)::text AS counter_credit,
      COUNT(CASE WHEN sd.document_type = 'invoice' THEN 1 END)::text AS inv_count
    FROM sales_documents sd
    WHERE sd.issue_date >= ${fromInstant}
      AND sd.issue_date < ${toInstant}
      AND sd.status != 'void'
      AND sd.document_type IN ('invoice', 'credit_note')
      ${locFilter}
  `);

  const sRow = salesRes.rows[0];
  const officeNet = Number(sRow?.office_gross || 0) - Number(sRow?.office_credit || 0);
  const counterNet = Number(sRow?.counter_gross || 0) - Number(sRow?.counter_credit || 0);
  const totalNet = officeNet + counterNet;
  const invoiceCount = Number(sRow?.inv_count || 0);

  // 2. Receivables (matches aged debtors)
  const arRes = await db.execute<{
    outstanding_minor: string;
    overdue_minor: string;
    overdue_count: string;
  }>(sql`
    SELECT
      COALESCE(SUM(balance_minor), 0)::text AS outstanding_minor,
      COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE THEN balance_minor ELSE 0 END), 0)::text AS overdue_minor,
      COUNT(CASE WHEN due_date < CURRENT_DATE THEN 1 END)::text AS overdue_count
    FROM sales_documents
    WHERE document_type = 'invoice'
      AND status IN ('issued', 'partially_paid', 'overdue')
      ${locationId ? sql`AND location_id = ${locationId}::uuid` : sql``}
  `);
  const arRow = arRes.rows[0];

  // 3. Low stock count (matches stock on hand report)
  const stockRes = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM stock_balances sb
    JOIN products p ON p.id = sb.product_id
    JOIN locations loc ON loc.id = sb.location_id
    WHERE p.is_active = TRUE
      AND p.min_stock_alert IS NOT NULL
      AND sb.on_hand <= p.min_stock_alert
      ${locationId ? sql`AND sb.location_id = ${locationId}::uuid` : sql``}
  `);

  // 4. Unreconciled payments
  const pmtRes = await db.execute<{ count: string; total_minor: string }>(sql`
    SELECT
      COUNT(*)::text AS count,
      COALESCE(SUM(amount_minor), 0)::text AS total_minor
    FROM payments
    WHERE status IN ('pending', 'awaiting_sale')
      ${locationId ? sql`AND location_id = ${locationId}::uuid` : sql``}
  `);
  const pmtRow = pmtRes.rows[0];

  // 5. Pending EIS count
  const eisRes = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM eis_submissions
    WHERE status IN ('pending', 'processing', 'failed')
  `);

  // 6. Open quotations (matches pipeline report)
  const quoteRes = await db.execute<{ count: string; total_minor: string }>(sql`
    SELECT
      COUNT(*)::text AS count,
      COALESCE(SUM(total_minor), 0)::text AS total_minor
    FROM quotations
    WHERE status IN ('draft', 'sent')
  `);
  const qRow = quoteRes.rows[0];

  // 7. Open shifts & latest variance
  const shiftRes = await db.execute<{ open_count: string; latest_variance: string | null }>(sql`
    WITH open_shf AS (
      SELECT COUNT(*)::text AS open_count
      FROM pos_shifts
      WHERE status = 'open'
        ${locationId ? sql`AND location_id = ${locationId}::uuid` : sql``}
    ),
    latest_closed AS (
      SELECT (counted_cash_minor - expected_cash_minor)::text AS latest_variance
      FROM pos_shifts
      WHERE status = 'closed'
        AND counted_cash_minor IS NOT NULL
        AND expected_cash_minor IS NOT NULL
        ${locationId ? sql`AND location_id = ${locationId}::uuid` : sql``}
      ORDER BY closed_at DESC
      LIMIT 1
    )
    SELECT
      os.open_count,
      lc.latest_variance
    FROM open_shf os
    LEFT JOIN latest_closed lc ON true
  `);
  const shfRow = shiftRes.rows[0];

  // 8. Exceptions count
  const excRes = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM payments
    WHERE flag_type IS NOT NULL
  `);

  return {
    salesToday: {
      totalNetMinor: totalNet,
      officeNetMinor: officeNet,
      counterNetMinor: counterNet,
      invoiceCount,
    },
    receivables: {
      outstandingMinor: Number(arRow?.outstanding_minor || 0),
      overdueMinor: Number(arRow?.overdue_minor || 0),
      overdueCount: Number(arRow?.overdue_count || 0),
    },
    lowStockCount: Number(stockRes.rows[0]?.count || 0),
    unreconciledPayments: {
      count: Number(pmtRow?.count || 0),
      totalMinor: Number(pmtRow?.total_minor || 0),
    },
    pendingEisCount: Number(eisRes.rows[0]?.count || 0),
    openQuotations: {
      count: Number(qRow?.count || 0),
      totalMinor: Number(qRow?.total_minor || 0),
    },
    openShifts: {
      openCount: Number(shfRow?.open_count || 0),
      latestVarianceMinor: shfRow?.latest_variance ? Number(shfRow.latest_variance) : null,
    },
    exceptionsCount: Number(excRes.rows[0]?.count || 0),
  };
}

export async function getSalesDashboardData(userId: string): Promise<SalesDashboardData> {
  const today = todayInCompanyTz();
  const fromInstant = startOfDayInCompanyTz(today);
  const toInstant = nextDayStart(today);

  // Own quotations
  const quoteRes = await db.execute<{ count: string; total_minor: string }>(sql`
    SELECT
      COUNT(*)::text AS count,
      COALESCE(SUM(total_minor), 0)::text AS total_minor
    FROM quotations
    WHERE created_by = ${userId}::uuid
      AND status IN ('draft', 'sent')
  `);
  const qRow = quoteRes.rows[0];

  // Own invoices today
  const invRes = await db.execute<{ count: string; total_minor: string }>(sql`
    SELECT
      COUNT(*)::text AS count,
      COALESCE(SUM(total_minor - tax_minor), 0)::text AS total_minor
    FROM sales_documents
    WHERE created_by = ${userId}::uuid
      AND document_type = 'invoice'
      AND status != 'void'
      AND issue_date >= ${fromInstant}
      AND issue_date < ${toInstant}
  `);
  const invRow = invRes.rows[0];

  return {
    ownQuotations: {
      count: Number(qRow?.count || 0),
      totalMinor: Number(qRow?.total_minor || 0),
    },
    ownInvoicesToday: {
      count: Number(invRow?.count || 0),
      totalMinor: Number(invRow?.total_minor || 0),
    },
    pipelineValueMinor: Number(qRow?.total_minor || 0),
  };
}

export async function getStorekeeperDashboardData(locationId?: string): Promise<StorekeeperDashboardData> {
  // Low stock count
  const stockRes = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM stock_balances sb
    JOIN products p ON p.id = sb.product_id
    JOIN locations loc ON loc.id = sb.location_id
    WHERE p.is_active = TRUE
      AND p.min_stock_alert IS NOT NULL
      AND sb.on_hand <= p.min_stock_alert
      ${locationId ? sql`AND sb.location_id = ${locationId}::uuid` : sql``}
  `);

  // Invoices awaiting delivery
  const delivRes = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM sales_documents
    WHERE document_type = 'invoice'
      AND status != 'void'
      AND delivery_status != 'delivered'
      ${locationId ? sql`AND location_id = ${locationId}::uuid` : sql``}
  `);

  // Purchase orders to receive
  const poRes = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM purchase_orders
    WHERE status IN ('approved', 'partially_received')
      ${locationId ? sql`AND location_id = ${locationId}::uuid` : sql``}
  `);

  return {
    lowStockCount: Number(stockRes.rows[0]?.count || 0),
    invoicesAwaitingDelivery: Number(delivRes.rows[0]?.count || 0),
    purchaseOrdersToReceive: Number(poRes.rows[0]?.count || 0),
  };
}

export async function getCashierDashboardData(userId: string): Promise<CashierDashboardData> {
  // Active shift only
  const shiftRes = await db.execute<{
    id: string;
    shift_number: string;
    opened_at: string;
    status: string;
  }>(sql`
    SELECT
      id,
      shift_number,
      to_char(opened_at AT TIME ZONE 'Africa/Blantyre', 'YYYY-MM-DD HH24:MI') AS opened_at,
      status
    FROM pos_shifts
    WHERE cashier_id = ${userId}::uuid
      AND status = 'open'
    ORDER BY opened_at DESC
    LIMIT 1
  `);

  const currentShift = shiftRes.rows[0]
    ? {
        id: shiftRes.rows[0].id,
        shiftNumber: shiftRes.rows[0].shift_number,
        openedAt: shiftRes.rows[0].opened_at,
        status: shiftRes.rows[0].status,
      }
    : null;

  // Sales count and items sold today on cashier's shift
  let salesCountToday = 0;
  let itemsSoldToday = 0;

  if (currentShift) {
    const statsRes = await db.execute<{
      sale_count: string;
      items_sold: string;
    }>(sql`
      SELECT
        COUNT(DISTINCT sd.id)::text AS sale_count,
        COALESCE(SUM(sdl.quantity), 0)::text AS items_sold
      FROM sales_documents sd
      LEFT JOIN sales_document_lines sdl ON sdl.document_id = sd.id
      WHERE sd.shift_id = ${currentShift.id}::uuid
        AND sd.status != 'void'
    `);
    const row = statsRes.rows[0];
    salesCountToday = Number(row?.sale_count || 0);
    itemsSoldToday = Number(row?.items_sold || 0);
  }

  return {
    currentShift,
    salesCountToday,
    itemsSoldToday,
  };
}

export async function getViewerDashboardData(): Promise<ViewerDashboardData> {
  const today = todayInCompanyTz();
  const fromInstant = startOfDayInCompanyTz(today);
  const toInstant = nextDayStart(today);

  const salesRes = await db.execute<{ net_minor: string }>(sql`
    SELECT
      (
        COALESCE(SUM(CASE WHEN sd.document_type = 'invoice' THEN (sd.total_minor - sd.tax_minor) ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN sd.document_type = 'credit_note' THEN (sd.total_minor - sd.tax_minor) ELSE 0 END), 0)
      )::text AS net_minor
    FROM sales_documents sd
    WHERE sd.issue_date >= ${fromInstant}
      AND sd.issue_date < ${toInstant}
      AND sd.status != 'void'
      AND sd.document_type IN ('invoice', 'credit_note')
  `);

  const stockRes = await db.execute<{
    product_count: string;
    units_on_hand: string;
  }>(sql`
    SELECT
      COUNT(DISTINCT p.id)::text AS product_count,
      COALESCE(SUM(sb.on_hand), 0)::text AS units_on_hand
    FROM products p
    LEFT JOIN stock_balances sb ON sb.product_id = p.id
    WHERE p.is_active = TRUE
  `);

  return {
    salesTodayNetMinor: Number(salesRes.rows[0]?.net_minor || 0),
    activeProductsCount: Number(stockRes.rows[0]?.product_count || 0),
    totalUnitsOnHand: Number(stockRes.rows[0]?.units_on_hand || 0),
  };
}
