/**
 * Controls Report Service (Phase 6) — Manager and Admin only.
 *
 * Exception register: discounts above threshold, sales below cost, voided invoices,
 * refunds, stock adjustments, payment reversals, receipt reprints, and manager overrides.
 * Reads from audit_log ordered by category.
 *
 * All date filtering uses indexed (at >= from AND at < to) — no AT TIME ZONE in WHERE.
 */

import { db } from '@/server/db';
import { sql } from 'drizzle-orm';
import { startOfDayInCompanyTz } from '@/lib/timezone';

function nextDayStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00+02:00');
  d.setDate(d.getDate() + 1);
  return d;
}

export interface ControlsEventRow {
  id: string;
  at: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorName: string | null;
  details: Record<string, unknown> | null;
}

export interface ControlsTotals {
  totalVoids: number;
  totalRefunds: number;
  totalReversals: number;
  totalAdjustments: number;
  totalOverrides: number;
  totalReprints: number;
  totalBelowCost: number;
  totalDiscountExceptions: number;
}

// Actions categorised as controls/exceptions
const CONTROLS_ACTIONS = [
  'invoice.void',
  'payment.refund',
  'payment.reverse',
  'stock.adjustment',
  'pos.override',
  'pos.reprint',
  'sale.below_cost',
  'discount.above_limit',
];

export async function getControlsReport(
  from: string,
  to: string,
  locationId?: string,
): Promise<{ rows: ControlsEventRow[]; totals: ControlsTotals }> {
  const fromInstant = startOfDayInCompanyTz(from);
  const toInstant = nextDayStart(to);

  const result = await db.execute<{
    id: string;
    at: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    actor_name: string | null;
    after: Record<string, unknown> | null;
  }>(sql`
    SELECT
      al.id,
      to_char(al.at AT TIME ZONE 'Africa/Blantyre', 'YYYY-MM-DD HH24:MI:SS') AS at,
      al.action,
      al.entity_type,
      al.entity_id::text AS entity_id,
      u.name AS actor_name,
      al.after
    FROM audit_log al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE al.at >= ${fromInstant}
      AND al.at < ${toInstant}
      AND al.action = ANY(${CONTROLS_ACTIONS})
    ORDER BY al.at DESC
  `);

  const rows: ControlsEventRow[] = result.rows.map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    actorName: r.actor_name,
    details: r.after,
  }));

  const totals: ControlsTotals = {
    totalVoids: rows.filter((r) => r.action === 'invoice.void').length,
    totalRefunds: rows.filter((r) => r.action === 'payment.refund').length,
    totalReversals: rows.filter((r) => r.action === 'payment.reverse').length,
    totalAdjustments: rows.filter((r) => r.action === 'stock.adjustment').length,
    totalOverrides: rows.filter((r) => r.action === 'pos.override').length,
    totalReprints: rows.filter((r) => r.action === 'pos.reprint').length,
    totalBelowCost: rows.filter((r) => r.action === 'sale.below_cost').length,
    totalDiscountExceptions: rows.filter((r) => r.action === 'discount.above_limit').length,
  };

  return { rows, totals };
}

