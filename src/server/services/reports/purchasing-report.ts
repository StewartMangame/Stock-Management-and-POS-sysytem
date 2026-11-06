/**
 * Purchasing Reports Service (Phase 6).
 *
 * Covers:
 *   1. Outstanding purchase orders (open quantities)
 *   2. Goods received summary by supplier
 *   3. Landed cost analysis
 */

import { db } from '@/server/db';
import { sql } from 'drizzle-orm';
import { startOfDayInCompanyTz } from '@/lib/timezone';

function nextDayStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00+02:00');
  d.setDate(d.getDate() + 1);
  return d;
}

export interface PurchasingOutstandingRow {
  orderId: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  locationName: string;
  totalOrderedMinor: number;
  totalReceivedMinor: number;
  outstandingMinor: number;
  ageInDays: number;
}

export interface GoodsReceivedRow {
  supplierId: string;
  supplierName: string;
  receiptCount: number;
  totalCostMinor: number;
  totalLandedCostMinor: number;
}

export interface LandedCostRow {
  receiptId: string;
  receiptNumber: string;
  supplierName: string;
  receivedDate: string;
  productCostMinor: number;
  freightMinor: number;
  dutyMinor: number;
  clearanceMinor: number;
  otherMinor: number;
  totalLandedMinor: number;
}

// ── Outstanding purchase orders ───────────────────────────────────────────────

export async function getOutstandingPurchaseOrders(): Promise<{
  rows: PurchasingOutstandingRow[];
}> {
  const result = await db.execute<{
    order_id: string;
    order_number: string;
    supplier_id: string;
    supplier_name: string;
    order_date: string;
    expected_delivery: string | null;
    location_name: string;
    total_ordered_minor: string;
    total_received_minor: string;
    age_days: string;
  }>(sql`
    SELECT
      po.id AS order_id,
      po.po_number AS order_number,
      s.id AS supplier_id,
      s.name AS supplier_name,
      to_char(po.order_date, 'YYYY-MM-DD') AS order_date,
      to_char(po.expected_delivery_date, 'YYYY-MM-DD') AS expected_delivery,
      loc.name AS location_name,
      po.total_minor::text AS total_ordered_minor,
      COALESCE(SUM(gr.total_items_mwk_minor), 0)::text AS total_received_minor,
      EXTRACT(DAY FROM NOW() - po.created_at)::text AS age_days
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    JOIN locations loc ON loc.id = po.location_id
    LEFT JOIN goods_receipts gr ON gr.purchase_order_id = po.id AND gr.status = 'completed'
    WHERE po.status IN ('draft', 'submitted', 'partially_received')
    GROUP BY po.id, po.po_number, s.id, s.name, po.order_date,
             po.expected_delivery_date, loc.name, po.total_minor, po.created_at
    ORDER BY po.order_date
  `);

  const rows: PurchasingOutstandingRow[] = result.rows.map((r) => {
    const ordered = Number(r.total_ordered_minor);
    const received = Number(r.total_received_minor);
    return {
      orderId: r.order_id,
      orderNumber: r.order_number,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      orderDate: r.order_date,
      expectedDeliveryDate: r.expected_delivery,
      locationName: r.location_name,
      totalOrderedMinor: ordered,
      totalReceivedMinor: received,
      outstandingMinor: ordered - received,
      ageInDays: Number(r.age_days),
    };
  });

  return { rows };
}

// ── Goods received summary ────────────────────────────────────────────────────

export async function getGoodsReceivedSummary(
  from: string,
  to: string,
): Promise<{ rows: GoodsReceivedRow[] }> {
  const fromInstant = startOfDayInCompanyTz(from);
  const toInstant = nextDayStart(to);

  const result = await db.execute<{
    supplier_id: string;
    supplier_name: string;
    receipt_count: string;
    total_cost_minor: string;
    total_landed_minor: string;
  }>(sql`
    SELECT
      s.id AS supplier_id,
      s.name AS supplier_name,
      COUNT(gr.id)::text AS receipt_count,
      COALESCE(SUM(gr.total_items_mwk_minor), 0)::text AS total_cost_minor,
      COALESCE(SUM(gr.total_items_mwk_minor + gr.total_landed_mwk_minor), 0)::text AS total_landed_minor
    FROM goods_receipts gr
    JOIN purchase_orders po ON po.id = gr.purchase_order_id
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE gr.received_date >= ${fromInstant}
      AND gr.received_date < ${toInstant}
      AND gr.status = 'completed'
    GROUP BY s.id, s.name
    ORDER BY total_cost_minor DESC
  `);

  return {
    rows: result.rows.map((r) => ({
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      receiptCount: Number(r.receipt_count),
      totalCostMinor: Number(r.total_cost_minor),
      totalLandedCostMinor: Number(r.total_landed_minor),
    })),
  };
}

// ── Landed cost analysis ──────────────────────────────────────────────────────

export async function getLandedCostAnalysis(
  from: string,
  to: string,
): Promise<{ rows: LandedCostRow[] }> {
  const fromInstant = startOfDayInCompanyTz(from);
  const toInstant = nextDayStart(to);

  const result = await db.execute<{
    receipt_id: string;
    receipt_number: string;
    supplier_name: string;
    received_date: string;
    product_cost_minor: string;
    freight_minor: string;
    duty_minor: string;
    clearance_minor: string;
    other_minor: string;
    total_landed_minor: string;
  }>(sql`
    SELECT
      gr.id AS receipt_id,
      gr.grn_number AS receipt_number,
      s.name AS supplier_name,
      to_char(gr.received_date, 'YYYY-MM-DD') AS received_date,
      gr.total_items_mwk_minor::text AS product_cost_minor,
      COALESCE(SUM(lc.amount_mwk_minor) FILTER (WHERE lc.cost_type = 'freight'), 0)::text AS freight_minor,
      COALESCE(SUM(lc.amount_mwk_minor) FILTER (WHERE lc.cost_type = 'duty'), 0)::text AS duty_minor,
      COALESCE(SUM(lc.amount_mwk_minor) FILTER (WHERE lc.cost_type = 'clearing'), 0)::text AS clearance_minor,
      COALESCE(SUM(lc.amount_mwk_minor) FILTER (WHERE lc.cost_type = 'other'), 0)::text AS other_minor,
      (gr.total_items_mwk_minor + gr.total_landed_mwk_minor)::text AS total_landed_minor
    FROM goods_receipts gr
    JOIN purchase_orders po ON po.id = gr.purchase_order_id
    JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN landed_costs lc ON lc.goods_receipt_id = gr.id
    WHERE gr.received_date >= ${fromInstant}
      AND gr.received_date < ${toInstant}
      AND gr.status = 'completed'
    GROUP BY gr.id, gr.grn_number, s.name, gr.received_date, gr.total_items_mwk_minor, gr.total_landed_mwk_minor
    ORDER BY gr.received_date DESC
  `);

  return {
    rows: result.rows.map((r) => ({
      receiptId: r.receipt_id,
      receiptNumber: r.receipt_number,
      supplierName: r.supplier_name,
      receivedDate: r.received_date,
      productCostMinor: Number(r.product_cost_minor),
      freightMinor: Number(r.freight_minor),
      dutyMinor: Number(r.duty_minor),
      clearanceMinor: Number(r.clearance_minor),
      otherMinor: Number(r.other_minor),
      totalLandedMinor: Number(r.total_landed_minor),
    })),
  };
}

