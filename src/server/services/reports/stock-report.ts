/**
 * Stock Report Services (Phase 6).
 *
 * Covers:
 *   1. Stock on hand by location (current snapshot)
 *   2. Stock valuation as of a past date (snapshot cache with stale fallback to ledger replay)
 *   3. Low stock & reorder recommendations
 *   4. Slow-moving stock (no sales in N days)
 *   5. Movement history for an item (delegates to existing ledger)
 *
 * Indexes used: stock_movements(product_id, location_id, occurred_at, seq)
 * Snapshot fallback: if stock_daily_snapshots for (date, product, location) is missing
 * or is_stale=true, replays ledger movements up to end of Africa/Blantyre day.
 */

import { db } from '@/server/db';
import { sql } from 'drizzle-orm';
import { startOfDayInCompanyTz, todayInCompanyTz } from '@/lib/timezone';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StockOnHandRow {
  productId: string;
  productName: string;
  sku: string;
  categoryName: string;
  locationId: string;
  locationName: string;
  onHand: number;
  reserved: number;
  available: number;
  avgCostMinor: number;      // costColumn
  valuationMinor: number;    // costColumn
  reorderLevel: number | null;
  isLow: boolean;
}

export interface StockValuationRow {
  productId: string;
  productName: string;
  sku: string;
  locationId: string;
  locationName: string;
  onHandAsOf: number;
  avgCostMinor: number;   // costColumn
  valuationMinor: number; // costColumn
  snapshotSource: 'snapshot' | 'replay';
}

export interface StockValuationTotals {
  totalValuationMinor: number; // costColumn
}

export interface LowStockRow {
  productId: string;
  productName: string;
  sku: string;
  locationId: string;
  locationName: string;
  onHand: number;
  reorderLevel: number;
  deficitQty: number;
  suggestedOrderQty: number;
}

export interface SlowMovingRow {
  productId: string;
  productName: string;
  sku: string;
  locationId: string;
  locationName: string;
  onHand: number;
  lastSaleDate: string | null;
  daysSinceLastSale: number | null;
  valuationMinor: number; // costColumn
}

// ── Stock on hand (current) ───────────────────────────────────────────────────

export async function getStockOnHand(
  locationId?: string,
  lowStockOnly = false,
): Promise<{ rows: StockOnHandRow[] }> {
  const locationFilter = locationId
    ? sql`AND sb.location_id = ${locationId}::uuid`
    : sql``;
  const lowStockFilter = lowStockOnly
    ? sql`AND sb.on_hand <= COALESCE(p.min_stock_alert, 0)`
    : sql``;

  const result = await db.execute<{
    product_id: string;
    product_name: string;
    sku: string;
    category_name: string;
    location_id: string;
    location_name: string;
    on_hand: string;
    reserved: string;
    available: string;
    avg_cost_minor: string;
    valuation_minor: string;
    reorder_level: string | null;
    is_low: string;
  }>(sql`
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      COALESCE(p.sku, '') AS sku,
      COALESCE(cat.name, 'Uncategorised') AS category_name,
      loc.id AS location_id,
      loc.name AS location_name,
      sb.on_hand::text,
      sb.reserved::text,
      sb.available::text,
      p.avg_cost_minor::text AS avg_cost_minor,
      (sb.on_hand * p.avg_cost_minor)::text AS valuation_minor,
      p.min_stock_alert::text AS reorder_level,
      (sb.on_hand <= COALESCE(p.min_stock_alert, -1))::text AS is_low
    FROM stock_balances sb
    JOIN products p ON p.id = sb.product_id
    JOIN locations loc ON loc.id = sb.location_id
    LEFT JOIN categories cat ON cat.id = p.category_id
    WHERE p.is_active = TRUE
      ${locationFilter}
      ${lowStockFilter}
    ORDER BY loc.name, p.name
  `);

  const rows: StockOnHandRow[] = result.rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    sku: r.sku,
    categoryName: r.category_name,
    locationId: r.location_id,
    locationName: r.location_name,
    onHand: Number(r.on_hand),
    reserved: Number(r.reserved),
    available: Number(r.available),
    avgCostMinor: Number(r.avg_cost_minor),
    valuationMinor: Number(r.valuation_minor),
    reorderLevel: r.reorder_level !== null ? Number(r.reorder_level) : null,
    isLow: r.is_low === 'true',
  }));

  return { rows };
}

// ── Stock valuation as of date ─────────────────────────────────────────────────
// Checks snapshot cache first; falls back to ledger replay if missing or stale.

export async function getStockValuationAsOf(
  asOf: string,
  locationId?: string,
): Promise<{ rows: StockValuationRow[]; totals: StockValuationTotals }> {
  const endOfDay = new Date(asOf + 'T23:59:59.999+02:00');
  const locationFilter = locationId ? sql`AND loc.id = ${locationId}::uuid` : sql``;

  // 1. Fetch all products with at least one movement up to asOf
  const replayResult = await db.execute<{
    product_id: string;
    product_name: string;
    sku: string;
    location_id: string;
    location_name: string;
    on_hand: string;
    avg_cost_minor: string;
    valuation_minor: string;
    has_snapshot: string;
    snapshot_stale: string;
  }>(sql`
    WITH snapshot_data AS (
      SELECT
        product_id,
        location_id,
        on_hand,
        average_cost_minor,
        valuation_minor,
        is_stale
      FROM stock_daily_snapshots
      WHERE snapshot_date = ${asOf}::date
    ),
    ledger_replay AS (
      SELECT
        sm.product_id,
        sm.location_id,
        SUM(sm.quantity) AS on_hand_replayed,
        CASE
          WHEN SUM(sm.quantity) > 0
          THEN ROUND(SUM(sm.total_cost_minor) / SUM(sm.quantity))::bigint
          ELSE 0
        END AS avg_cost_replayed,
        ROUND(SUM(sm.total_cost_minor))::bigint AS valuation_replayed
      FROM stock_movements sm
      WHERE sm.occurred_at >= '1970-01-01'
        AND sm.occurred_at <= ${endOfDay}
      GROUP BY sm.product_id, sm.location_id
      HAVING SUM(sm.quantity) > 0
    )
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      COALESCE(p.sku, '') AS sku,
      loc.id AS location_id,
      loc.name AS location_name,
      CASE
        WHEN sn.is_stale = FALSE AND sn.product_id IS NOT NULL
        THEN sn.on_hand::text
        ELSE COALESCE(lr.on_hand_replayed, 0)::text
      END AS on_hand,
      CASE
        WHEN sn.is_stale = FALSE AND sn.product_id IS NOT NULL
        THEN sn.average_cost_minor::text
        ELSE COALESCE(lr.avg_cost_replayed, 0)::text
      END AS avg_cost_minor,
      CASE
        WHEN sn.is_stale = FALSE AND sn.product_id IS NOT NULL
        THEN sn.valuation_minor::text
        ELSE COALESCE(lr.valuation_replayed, 0)::text
      END AS valuation_minor,
      (sn.product_id IS NOT NULL)::text AS has_snapshot,
      COALESCE(sn.is_stale, true)::text AS snapshot_stale
    FROM ledger_replay lr
    JOIN products p ON p.id = lr.product_id
    JOIN locations loc ON loc.id = lr.location_id
    LEFT JOIN snapshot_data sn ON sn.product_id = lr.product_id AND sn.location_id = lr.location_id
    WHERE p.is_active = TRUE
      ${locationFilter}
    ORDER BY loc.name, p.name
  `);

  const rows: StockValuationRow[] = replayResult.rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    sku: r.sku,
    locationId: r.location_id,
    locationName: r.location_name,
    onHandAsOf: Number(r.on_hand),
    avgCostMinor: Number(r.avg_cost_minor),
    valuationMinor: Number(r.valuation_minor),
    snapshotSource:
      r.has_snapshot === 'true' && r.snapshot_stale === 'false' ? 'snapshot' : 'replay',
  }));

  const total = rows.reduce((s, r) => s + r.valuationMinor, 0);
  return { rows, totals: { totalValuationMinor: total } };
}

// ── Low stock and reorder recommendations ─────────────────────────────────────

export async function getLowStockReport(
  locationId?: string,
): Promise<{ rows: LowStockRow[] }> {
  const locationFilter = locationId
    ? sql`AND sb.location_id = ${locationId}::uuid`
    : sql``;

  const result = await db.execute<{
    product_id: string;
    product_name: string;
    sku: string;
    location_id: string;
    location_name: string;
    on_hand: string;
    reorder_level: string;
  }>(sql`
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      COALESCE(p.sku, '') AS sku,
      loc.id AS location_id,
      loc.name AS location_name,
      sb.on_hand::text,
      p.min_stock_alert::text AS reorder_level
    FROM stock_balances sb
    JOIN products p ON p.id = sb.product_id AND p.is_active = TRUE AND p.min_stock_alert IS NOT NULL
    JOIN locations loc ON loc.id = sb.location_id
    WHERE sb.on_hand <= p.min_stock_alert
      ${locationFilter}
    ORDER BY (p.min_stock_alert - sb.on_hand::numeric) DESC
  `);

  const rows: LowStockRow[] = result.rows.map((r) => {
    const onHand = Number(r.on_hand);
    const reorderLevel = Number(r.reorder_level);
    return {
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku,
      locationId: r.location_id,
      locationName: r.location_name,
      onHand,
      reorderLevel,
      deficitQty: Math.max(0, reorderLevel - onHand),
      suggestedOrderQty: Math.max(0, reorderLevel * 2 - onHand), // simple 2x reorder heuristic
    };
  });

  return { rows };
}

// ── Slow-moving stock ─────────────────────────────────────────────────────────

export async function getSlowMovingStock(
  daysThreshold: number = 60,
  locationId?: string,
): Promise<{ rows: SlowMovingRow[] }> {
  const cutoffInstant = new Date();
  cutoffInstant.setDate(cutoffInstant.getDate() - daysThreshold);

  const locationFilter = locationId
    ? sql`AND sb.location_id = ${locationId}::uuid`
    : sql``;

  const result = await db.execute<{
    product_id: string;
    product_name: string;
    sku: string;
    location_id: string;
    location_name: string;
    on_hand: string;
    last_sale_date: string | null;
    days_since_last_sale: string | null;
    valuation_minor: string;
  }>(sql`
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      COALESCE(p.sku, '') AS sku,
      loc.id AS location_id,
      loc.name AS location_name,
      sb.on_hand::text,
      to_char(MAX(sm_sale.occurred_at) AT TIME ZONE 'Africa/Blantyre', 'YYYY-MM-DD') AS last_sale_date,
      EXTRACT(DAY FROM NOW() - MAX(sm_sale.occurred_at))::text AS days_since_last_sale,
      (sb.on_hand * p.avg_cost_minor)::text AS valuation_minor
    FROM stock_balances sb
    JOIN products p ON p.id = sb.product_id AND p.is_active = TRUE
    JOIN locations loc ON loc.id = sb.location_id
    LEFT JOIN stock_movements sm_sale
      ON sm_sale.product_id = sb.product_id
      AND sm_sale.location_id = sb.location_id
      AND sm_sale.movement_type = 'sale_delivery'
    WHERE sb.on_hand > 0
      ${locationFilter}
    GROUP BY p.id, p.name, p.sku, loc.id, loc.name, sb.on_hand, p.avg_cost_minor
    HAVING MAX(sm_sale.occurred_at) IS NULL
       OR MAX(sm_sale.occurred_at) < ${cutoffInstant}
    ORDER BY days_since_last_sale DESC NULLS FIRST
  `);

  const rows: SlowMovingRow[] = result.rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    sku: r.sku,
    locationId: r.location_id,
    locationName: r.location_name,
    onHand: Number(r.on_hand),
    lastSaleDate: r.last_sale_date,
    daysSinceLastSale: r.days_since_last_sale !== null ? Number(r.days_since_last_sale) : null,
    valuationMinor: Number(r.valuation_minor),
  }));

  return { rows };
}

