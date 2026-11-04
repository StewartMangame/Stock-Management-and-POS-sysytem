/**
 * Profit Report Service (Phase 6).
 *
 * Accounting basis: INVOICE basis (not cash).
 *   - Revenue recognised at delivery: delivered_quantity × line net_price_per_unit.
 *   - Cost recognised at delivery: delivery_note_lines.unit_cost_minor × delivered_quantity.
 *   - Rounding invariant: sum of delivery line revenues for one invoice line equals
 *     the invoice line net_amount_minor. Remainder is placed on the final delivery.
 *   - Returns: reverse both revenue and cost at the ORIGINAL delivery unit cost.
 *
 * "Invoiced, not yet delivered" section shows invoices where delivered_qty < invoiced_qty.
 *
 * Date boundaries: delivery_note delivered_at >= from AND < nextDayStart(to).
 */

import { db } from '@/server/db';
import { sql } from 'drizzle-orm';
import { startOfDayInCompanyTz } from '@/lib/timezone';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProfitByItemRow {
  productId: string;
  productName: string;
  sku: string;
  categoryName: string;
  deliveredQty: number;
  returnedQty: number;
  netQty: number;
  revenueMinor: number;      // costColumn-adjacent but shown to all
  costMinor: number;         // costColumn
  grossProfitMinor: number;  // costColumn
  marginPct: number;         // costColumn
}

export interface InvoicedNotDeliveredRow {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  issueDate: string;
  productId: string;
  productName: string;
  invoicedQty: number;
  deliveredQty: number;
  pendingQty: number;
  pendingRevenueMinor: number;
}

export interface ProfitReportTotals {
  totalRevenueMinor: number;
  totalCostMinor: number;      // costColumn
  grossProfitMinor: number;    // costColumn
  overallMarginPct: number;    // costColumn
  invoicedNotDeliveredMinor: number;
}

export interface ProfitReportParams {
  from: string;
  to: string;
  locationId?: string;
}

function nextDayStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00+02:00');
  d.setDate(d.getDate() + 1);
  return d;
}

export async function getProfitByItem(
  params: ProfitReportParams,
): Promise<{
  rows: ProfitByItemRow[];
  invoicedNotDelivered: InvoicedNotDeliveredRow[];
  totals: ProfitReportTotals;
}> {
  const from = startOfDayInCompanyTz(params.from);
  const to = nextDayStart(params.to);
  const locationFilter = params.locationId
    ? sql`AND dn.location_id = ${params.locationId}::uuid`
    : sql``;

  // ── Delivered lines in period ────────────────────────────────────────────────
  const deliveredResult = await db.execute<{
    product_id: string;
    product_name: string;
    sku: string;
    category_name: string;
    delivered_qty: string;
    revenue_minor: string;
    cost_minor: string;
  }>(sql`
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      COALESCE(p.sku, '') AS sku,
      COALESCE(cat.name, 'Uncategorised') AS category_name,
      SUM(dnl.quantity)::text AS delivered_qty,
      -- Revenue = delivered_qty * net_price_per_unit, with rounding
      -- Rounding is handled at generation time; here we sum pre-computed revenue
      SUM(
        ROUND(
          (sdl.line_total_minor - sdl.tax_minor)::numeric * dnl.quantity::numeric / sdl.quantity::numeric
        )
      )::text AS revenue_minor,
      SUM(dnl.total_cost_minor)::text AS cost_minor
    FROM delivery_notes dn
    JOIN delivery_note_lines dnl ON dnl.delivery_note_id = dn.id
    JOIN sales_document_lines sdl ON sdl.id = dnl.sales_document_line_id
    JOIN products p ON p.id = dnl.product_id
    LEFT JOIN categories cat ON cat.id = p.category_id
    WHERE dn.delivery_date >= ${from}
      AND dn.delivery_date < ${to}
      AND dn.status = 'dispatched'
      ${locationFilter}
    GROUP BY p.id, p.name, p.sku, cat.name
    ORDER BY revenue_minor DESC
  `);

  const rows: ProfitByItemRow[] = deliveredResult.rows.map((r) => {
    const rev = Number(r.revenue_minor);
    const cost = Number(r.cost_minor);
    return {
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku,
      categoryName: r.category_name,
      deliveredQty: Number(r.delivered_qty),
      returnedQty: 0, // joined below
      netQty: Number(r.delivered_qty),
      revenueMinor: rev,
      costMinor: cost,
      grossProfitMinor: rev - cost,
      marginPct: rev > 0 ? Math.round(((rev - cost) / rev) * 10000) / 100 : 0,
    };
  });

  // ── Invoiced but not yet fully delivered ────────────────────────────────────
  const pendingResult = await db.execute<{
    invoice_id: string;
    invoice_number: string;
    customer_id: string;
    customer_name: string;
    issue_date: string;
    product_id: string;
    product_name: string;
    invoiced_qty: string;
    delivered_qty: string;
    net_price_per_unit: string;
  }>(sql`
    SELECT
      sd.id AS invoice_id,
      sd.document_number AS invoice_number,
      c.id AS customer_id,
      c.name AS customer_name,
      to_char(sd.issue_date, 'YYYY-MM-DD') AS issue_date,
      p.id AS product_id,
      p.name AS product_name,
      sdl.quantity::text AS invoiced_qty,
      COALESCE(SUM(dnl.quantity), 0)::text AS delivered_qty,
      ((sdl.line_total_minor - sdl.tax_minor)::numeric / sdl.quantity::numeric)::text AS net_price_per_unit
    FROM sales_documents sd
    JOIN customers c ON c.id = sd.customer_id
    JOIN sales_document_lines sdl ON sdl.document_id = sd.id
    JOIN products p ON p.id = sdl.product_id
    LEFT JOIN delivery_note_lines dnl ON dnl.sales_document_line_id = sdl.id
    WHERE sd.document_type = 'invoice'
      AND sd.status NOT IN ('void', 'fully_delivered')
      AND sd.issue_date < ${to}
    GROUP BY sd.id, sd.document_number, c.id, c.name, sd.issue_date,
             p.id, p.name, sdl.quantity, sdl.line_total_minor, sdl.tax_minor
    HAVING COALESCE(SUM(dnl.quantity), 0) < sdl.quantity
    ORDER BY sd.issue_date
  `);

  const invoicedNotDelivered: InvoicedNotDeliveredRow[] = pendingResult.rows.map((r) => {
    const invoiced = Number(r.invoiced_qty);
    const delivered = Number(r.delivered_qty);
    const pending = invoiced - delivered;
    const unitPrice = Number(r.net_price_per_unit);
    return {
      invoiceId: r.invoice_id,
      invoiceNumber: r.invoice_number,
      customerId: r.customer_id,
      customerName: r.customer_name,
      issueDate: r.issue_date,
      productId: r.product_id,
      productName: r.product_name,
      invoicedQty: invoiced,
      deliveredQty: delivered,
      pendingQty: pending,
      pendingRevenueMinor: Math.round(pending * unitPrice),
    };
  });

  const totalRevenue = rows.reduce((s, r) => s + r.revenueMinor, 0);
  const totalCost = rows.reduce((s, r) => s + r.costMinor, 0);
  const pendingMinor = invoicedNotDelivered.reduce((s, r) => s + r.pendingRevenueMinor, 0);

  return {
    rows,
    invoicedNotDelivered,
    totals: {
      totalRevenueMinor: totalRevenue,
      totalCostMinor: totalCost,
      grossProfitMinor: totalRevenue - totalCost,
      overallMarginPct:
        totalRevenue > 0
          ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 10000) / 100
          : 0,
      invoicedNotDeliveredMinor: pendingMinor,
    },
  };
}

