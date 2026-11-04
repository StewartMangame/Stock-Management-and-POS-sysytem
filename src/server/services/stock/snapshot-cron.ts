/**
 * Stock Daily Snapshot Cron Service (Phase 6).
 *
 * Takes end-of-day snapshots (23:59:59 Africa/Blantyre) for all product/location
 * combinations that have stock movements. Called by an API route on a schedule.
 *
 * Snapshot invariant:
 *   snapshotted on_hand === replay of stock_movements up to end of that day.
 *
 * Stale snapshots are those marked is_stale=true by the backdated movement trigger.
 * This cron also recomputes stale snapshots for past dates (up to 90 days back).
 */

import { db } from '@/server/db';
import { sql } from 'drizzle-orm';
import { todayInCompanyTz } from '@/lib/timezone';

export interface SnapshotResult {
  date: string;
  createdCount: number;
  updatedStaleCount: number;
  durationMs: number;
}

/**
 * Takes a snapshot for a specific Africa/Blantyre date (YYYY-MM-DD).
 * Replays the ledger up to 23:59:59.999 of that date and upserts the snapshot.
 */
export async function takeSnapshotForDate(snapshotDate: string): Promise<void> {
  const endOfDay = new Date(snapshotDate + 'T23:59:59.999+02:00');

  await db.execute(sql`
    INSERT INTO stock_daily_snapshots
      (snapshot_date, product_id, location_id, on_hand, average_cost_minor, valuation_minor, is_stale, updated_at)
    SELECT
      ${snapshotDate}::date AS snapshot_date,
      sm.product_id,
      sm.location_id,
      SUM(sm.quantity) AS on_hand,
      CASE
        WHEN SUM(sm.quantity) > 0
        THEN ROUND(SUM(sm.total_cost_minor)::numeric / SUM(sm.quantity)::numeric)::bigint
        ELSE 0
      END AS average_cost_minor,
      CASE
        WHEN SUM(sm.quantity) > 0
        THEN ROUND(SUM(sm.total_cost_minor)::numeric)::bigint
        ELSE 0
      END AS valuation_minor,
      FALSE AS is_stale,
      NOW() AS updated_at
    FROM stock_movements sm
    WHERE sm.occurred_at <= ${endOfDay}
    GROUP BY sm.product_id, sm.location_id
    HAVING SUM(sm.quantity) >= 0
    ON CONFLICT (snapshot_date, product_id, location_id)
    DO UPDATE SET
      on_hand             = EXCLUDED.on_hand,
      average_cost_minor  = EXCLUDED.average_cost_minor,
      valuation_minor     = EXCLUDED.valuation_minor,
      is_stale            = FALSE,
      updated_at          = NOW()
  `);
}

/**
 * Main cron entry point.
 * 1. Takes today's snapshot.
 * 2. Recomputes all stale snapshots (up to 90 days back).
 */
export async function runSnapshotCron(): Promise<SnapshotResult> {
  const start = Date.now();
  const today = todayInCompanyTz();

  // Take today's snapshot
  await takeSnapshotForDate(today);

  // Recompute stale snapshots
  const staleResult = await db.execute<{ snapshot_date: string; product_id: string; location_id: string }>(sql`
    SELECT DISTINCT snapshot_date::text, product_id::text, location_id::text
    FROM stock_daily_snapshots
    WHERE is_stale = TRUE
      AND snapshot_date >= (NOW() AT TIME ZONE 'Africa/Blantyre')::date - INTERVAL '90 days'
    ORDER BY snapshot_date
  `);

  for (const row of staleResult.rows) {
    await takeSnapshotForDate(row.snapshot_date);
  }

  return {
    date: today,
    createdCount: 1,
    updatedStaleCount: staleResult.rows.length,
    durationMs: Date.now() - start,
  };
}

