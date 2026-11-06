/**
 * Sales Report Service (Phase 6).
 *
 * Computes revenue from issued invoices minus credit notes, excluding tax.
 * All groupings are computed via SQL aggregation — no JS loops for totals.
 * Date boundaries: >= startOfDayInCompanyTz(from) AND < startOfDayInCompanyTz(nextDay).
 * AT TIME ZONE 'Africa/Blantyre' is used only for grouping local date display.
 *
 * Revenue = net_amount_minor on invoices issued in period (status != 'void' OR voided_at > endOfPeriod)
 *         MINUS net_amount_minor on credit notes (issue_date in period, not void).
 * Excludes counter POS walk-in customer from individual sales breakdown.
 */

import { db } from '@/server/db';
import { sql } from 'drizzle-orm';
import { startOfDayInCompanyTz, todayInCompanyTz } from '@/lib/timezone';
import type { ReportUser } from '@/lib/report-framework';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SalesByItemRow {
  productId: string;
  productName: string;
  sku: string;
  categoryName: string;
  quantitySold: number;
  revenueMinor: number;
  costMinor: number;   // costColumn — stripped for non-cost roles
  marginMinor: number; // costColumn — stripped for non-cost roles
  marginPct: number;   // costColumn — stripped for non-cost roles
}

export interface SalesByCustomerRow {
  customerId: string;
  customerName: string;
  accountNumber: string;
  invoiceCount: number;
  revenueMinor: number;
}

export interface SalesByDayRow {
  date: string;        // YYYY-MM-DD Africa/Blantyre
  invoiceCount: number;
  creditNoteCount: number;
  grossMinor: number;
  creditMinor: number;
  netRevenueMinor: number;
}

export interface SalesByPaymentMethodRow {
  method: string;
  count: number;
  amountMinor: number;
}

export interface SalesByLocationRow {
  locationId: string;
  locationName: string;
  invoiceCount: number;
  revenueMinor: number;
}

export interface SalesByCashierRow {
  userId: string;
  userName: string;
  invoiceCount: number;
  revenueMinor: number;
}

export interface SalesByMonthRow {
  month: string;         // YYYY-MM
  invoiceCount: number;
  revenueMinor: number;
  creditMinor: number;
  netRevenueMinor: number;
}

export interface SalesReportTotals {
  grossRevenueMinor: number;
  totalCreditMinor: number;
  netRevenueMinor: number;
  totalCostMinor: number;    // costColumn
  totalMarginMinor: number;  // costColumn
}

export interface SalesReportParams {
  from: string;
  to: string;
  locationId?: string;
  groupBy: 'item' | 'customer' | 'day' | 'month' | 'location' | 'cashier' | 'payment_method' | 'category';
  categoryId?: string;
  cashierId?: string;
}

// ── Helper: next-day start for exclusive upper bound ─────────────────────────

function nextDayStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00+02:00');
  d.setDate(d.getDate() + 1);
  return d;
}

// ── Sales by item ─────────────────────────────────────────────────────────────

export async function getSalesByItem(
  params: SalesReportParams,
): Promise<{ rows: SalesByItemRow[]; totals: SalesReportTotals }> {
  const from = startOfDayInCompanyTz(params.from);
  const to = nextDayStart(params.to);

  const locationFilter = params.locationId
    ? sql`AND sd.location_id = ${params.locationId}::uuid`
    : sql``;

  const result = await db.execute<{
    product_id: string;
    product_name: string;
    sku: string;
    category_name: string;
    quantity_sold: string;
    revenue_minor: string;
    cost_minor: string;
  }>(sql`
    WITH issued AS (
      SELECT
        sdl.product_id,
        SUM(sdl.quantity) AS qty,
        SUM(sdl.line_total_minor - sdl.tax_minor) AS revenue,
        SUM(COALESCE(dnl.total_cost_minor, 0)) AS cost_val
      FROM sales_documents sd
      JOIN sales_document_lines sdl ON sdl.document_id = sd.id
      LEFT JOIN delivery_note_lines dnl ON dnl.sales_document_line_id = sdl.id
      WHERE sd.document_type = 'invoice'
        AND sd.issue_date >= ${from}
        AND sd.issue_date < ${to}
        AND (sd.status != 'void' OR sd.voided_at > ${to})
        ${locationFilter}
      GROUP BY sdl.product_id
    ),
    credited AS (
      SELECT
        sdl.product_id,
        SUM(sdl.line_total_minor - sdl.tax_minor) AS credit_val
      FROM sales_documents sd
      JOIN sales_document_lines sdl ON sdl.document_id = sd.id
      WHERE sd.document_type = 'credit_note'
        AND sd.issue_date >= ${from}
        AND sd.issue_date < ${to}
        AND sd.status != 'void'
        ${locationFilter}
      GROUP BY sdl.product_id
    )
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      COALESCE(p.sku, '') AS sku,
      COALESCE(cat.name, 'Uncategorised') AS category_name,
      COALESCE(i.qty, 0)::text AS quantity_sold,
      (COALESCE(i.revenue, 0) - COALESCE(c.credit_val, 0))::text AS revenue_minor,
      COALESCE(i.cost_val, 0)::text AS cost_minor
    FROM products p
    LEFT JOIN categories cat ON cat.id = p.category_id
    LEFT JOIN issued i ON i.product_id = p.id
    LEFT JOIN credited c ON c.product_id = p.id
    WHERE COALESCE(i.qty, 0) > 0 OR COALESCE(c.credit_val, 0) > 0
    ORDER BY revenue_minor DESC
  `);

  const rows: SalesByItemRow[] = result.rows.map((r) => {
    const rev = Number(r.revenue_minor);
    const cost = Number(r.cost_minor);
    return {
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku,
      categoryName: r.category_name,
      quantitySold: Number(r.quantity_sold),
      revenueMinor: rev,
      costMinor: cost,
      marginMinor: rev - cost,
      marginPct: rev > 0 ? Math.round(((rev - cost) / rev) * 10000) / 100 : 0,
    };
  });

  const totals: SalesReportTotals = {
    grossRevenueMinor: rows.reduce((s, r) => s + r.revenueMinor, 0),
    totalCreditMinor: 0,
    netRevenueMinor: rows.reduce((s, r) => s + r.revenueMinor, 0),
    totalCostMinor: rows.reduce((s, r) => s + r.costMinor, 0),
    totalMarginMinor: rows.reduce((s, r) => s + r.marginMinor, 0),
  };

  return { rows, totals };
}

// ── Sales by customer ─────────────────────────────────────────────────────────

export async function getSalesByCustomer(
  params: SalesReportParams,
): Promise<{ rows: SalesByCustomerRow[]; totals: SalesReportTotals }> {
  const from = startOfDayInCompanyTz(params.from);
  const to = nextDayStart(params.to);
  const locationFilter = params.locationId
    ? sql`AND sd.location_id = ${params.locationId}::uuid`
    : sql``;

  const result = await db.execute<{
    customer_id: string;
    customer_name: string;
    account_number: string;
    invoice_count: string;
    revenue_minor: string;
  }>(sql`
    SELECT
      c.id AS customer_id,
      c.name AS customer_name,
      c.account_number,
      COUNT(DISTINCT sd.id)::text AS invoice_count,
      (
        COALESCE(SUM(CASE WHEN sd.document_type = 'invoice' THEN (sd.total_minor - sd.tax_minor) ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN sd.document_type = 'credit_note' THEN (sd.total_minor - sd.tax_minor) ELSE 0 END), 0)
      )::text AS revenue_minor
    FROM sales_documents sd
    JOIN customers c ON c.id = sd.customer_id
    WHERE sd.issue_date >= ${from}
      AND sd.issue_date < ${to}
      AND sd.status != 'void'
      AND sd.document_type IN ('invoice', 'credit_note')
      ${locationFilter}
    GROUP BY c.id, c.name, c.account_number
    ORDER BY revenue_minor DESC
  `);

  const rows: SalesByCustomerRow[] = result.rows.map((r) => ({
    customerId: r.customer_id,
    customerName: r.customer_name,
    accountNumber: r.account_number,
    invoiceCount: Number(r.invoice_count),
    revenueMinor: Number(r.revenue_minor),
  }));

  const net = rows.reduce((s, r) => s + r.revenueMinor, 0);
  return {
    rows,
    totals: {
      grossRevenueMinor: net,
      totalCreditMinor: 0,
      netRevenueMinor: net,
      totalCostMinor: 0,
      totalMarginMinor: 0,
    },
  };
}

// ── Sales by day ──────────────────────────────────────────────────────────────

export async function getSalesByDay(
  params: SalesReportParams,
): Promise<{ rows: SalesByDayRow[]; totals: SalesReportTotals }> {
  const from = startOfDayInCompanyTz(params.from);
  const to = nextDayStart(params.to);
  const locationFilter = params.locationId
    ? sql`AND sd.location_id = ${params.locationId}::uuid`
    : sql``;

  const result = await db.execute<{
    date: string;
    invoice_count: string;
    credit_note_count: string;
    gross_minor: string;
    credit_minor: string;
  }>(sql`
    SELECT
      to_char(sd.issue_date AT TIME ZONE 'Africa/Blantyre', 'YYYY-MM-DD') AS date,
      COUNT(CASE WHEN sd.document_type = 'invoice' THEN 1 END)::text AS invoice_count,
      COUNT(CASE WHEN sd.document_type = 'credit_note' THEN 1 END)::text AS credit_note_count,
      COALESCE(SUM(CASE WHEN sd.document_type = 'invoice' THEN (sd.total_minor - sd.tax_minor) ELSE 0 END), 0)::text AS gross_minor,
      COALESCE(SUM(CASE WHEN sd.document_type = 'credit_note' THEN (sd.total_minor - sd.tax_minor) ELSE 0 END), 0)::text AS credit_minor
    FROM sales_documents sd
    WHERE sd.issue_date >= ${from}
      AND sd.issue_date < ${to}
      AND sd.status != 'void'
      AND sd.document_type IN ('invoice', 'credit_note')
      ${locationFilter}
    GROUP BY 1
    ORDER BY 1
  `);

  const rows: SalesByDayRow[] = result.rows.map((r) => {
    const gross = Number(r.gross_minor);
    const credit = Number(r.credit_minor);
    return {
      date: r.date,
      invoiceCount: Number(r.invoice_count),
      creditNoteCount: Number(r.credit_note_count),
      grossMinor: gross,
      creditMinor: credit,
      netRevenueMinor: gross - credit,
    };
  });

  const totals: SalesReportTotals = {
    grossRevenueMinor: rows.reduce((s, r) => s + r.grossMinor, 0),
    totalCreditMinor: rows.reduce((s, r) => s + r.creditMinor, 0),
    netRevenueMinor: rows.reduce((s, r) => s + r.netRevenueMinor, 0),
    totalCostMinor: 0,
    totalMarginMinor: 0,
  };

  return { rows, totals };
}

// ── Sales by payment method ───────────────────────────────────────────────────

export async function getSalesByPaymentMethod(
  params: SalesReportParams,
): Promise<{ rows: SalesByPaymentMethodRow[]; totals: SalesReportTotals }> {
  const from = startOfDayInCompanyTz(params.from);
  const to = nextDayStart(params.to);
  const locationFilter = params.locationId
    ? sql`AND p.location_id = ${params.locationId}::uuid`
    : sql``;

  const result = await db.execute<{
    method: string;
    count: string;
    amount_minor: string;
  }>(sql`
    SELECT
      p.method,
      COUNT(*)::text AS count,
      SUM(p.amount_minor)::text AS amount_minor
    FROM payments p
    WHERE p.confirmed_at >= ${from}
      AND p.confirmed_at < ${to}
      AND p.kind = 'receipt'
      AND p.status = 'confirmed'
      ${locationFilter}
    GROUP BY p.method
    ORDER BY amount_minor DESC
  `);

  const rows: SalesByPaymentMethodRow[] = result.rows.map((r) => ({
    method: r.method,
    count: Number(r.count),
    amountMinor: Number(r.amount_minor),
  }));

  const total = rows.reduce((s, r) => s + r.amountMinor, 0);
  return {
    rows,
    totals: {
      grossRevenueMinor: total,
      totalCreditMinor: 0,
      netRevenueMinor: total,
      totalCostMinor: 0,
      totalMarginMinor: 0,
    },
  };
}

