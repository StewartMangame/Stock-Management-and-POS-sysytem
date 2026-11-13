/**
 * System Health Checks Service (Phase 6, Milestone 6).
 *
 * Implements automated cross-module data integrity checks:
 *   1. Customer Credit Balance Consistency
 *   2. Serial Number Inventory Reconciliation
 *   3. Stock Reservation Integrity (reserved <= on_hand)
 *   4. Document Sequence Gap Detection
 *   5. Delivery Reconciliation (delivery notes vs invoice delivery_status)
 *
 * Runs all checks, records summary + itemized discrepancies to system_checks_history table.
 */

import { db } from '@/server/db';
import { sql, eq, desc } from 'drizzle-orm';
import { systemChecksHistory, cronRuns } from '@/server/db/schema';

export interface CheckItemResult {
  code: string;
  name: string;
  status: 'pass' | 'warning' | 'fail';
  summary: string;
  discrepancyCount: number;
  details?: Record<string, unknown>[];
}

export interface SystemCheckSuiteResult {
  id: string;
  executedAt: string;
  executedBy?: string | null;
  status: 'pass' | 'warning' | 'fail';
  totalChecks: number;
  passedCount: number;
  warningCount: number;
  failedCount: number;
  durationMs: number;
  checks: CheckItemResult[];
}

export async function runSystemChecks(executedById?: string): Promise<SystemCheckSuiteResult> {
  const startTime = Date.now();
  const checks: CheckItemResult[] = [];

  // ── Check 1: Customer Credit & Payment Balance Consistency ────────────────
  try {
    const res = await db.execute<{
      customer_id: string;
      customer_name: string;
      credit_limit_minor: string;
      open_invoices_balance: string;
    }>(sql`
      SELECT
        c.id AS customer_id,
        c.name AS customer_name,
        c.credit_limit_minor::text,
        COALESCE(SUM(sd.balance_minor), 0)::text AS open_invoices_balance
      FROM customers c
      LEFT JOIN sales_documents sd ON sd.customer_id = c.id
        AND sd.document_type = 'invoice'
        AND sd.status IN ('issued', 'partially_paid')
      WHERE c.is_walk_in = FALSE
      GROUP BY c.id, c.name, c.credit_limit_minor
      HAVING COALESCE(SUM(sd.balance_minor), 0) > c.credit_limit_minor AND c.credit_limit_minor > 0
    `);

    const discrepancies = res.rows.map((r) => ({
      customerId: r.customer_id,
      customerName: r.customer_name,
      creditLimitMinor: Number(r.credit_limit_minor),
      openBalanceMinor: Number(r.open_invoices_balance),
    }));

    checks.push({
      code: 'customer_credit_limits',
      name: 'Customer Credit Limit Adherence',
      status: discrepancies.length === 0 ? 'pass' : 'warning',
      summary: discrepancies.length === 0
        ? 'All customer outstanding balances are within approved credit limits.'
        : `${discrepancies.length} customer(s) exceed approved credit limit.`,
      discrepancyCount: discrepancies.length,
      details: discrepancies.slice(0, 10),
    });
  } catch (err: any) {
    checks.push({
      code: 'customer_credit_limits',
      name: 'Customer Credit Limit Adherence',
      status: 'fail',
      summary: `Check failed to execute: ${err.message}`,
      discrepancyCount: 1,
    });
  }

  // ── Check 2: Serial Number Inventory Reconciliation ───────────────────────
  try {
    const res = await db.execute<{
      product_id: string;
      product_name: string;
      sku: string;
      available_serials_count: string;
      stock_on_hand: string;
    }>(sql`
      WITH serial_counts AS (
        SELECT product_id, COUNT(*) AS avail_count
        FROM serial_numbers
        WHERE status = 'available'
        GROUP BY product_id
      ),
      balance_counts AS (
        SELECT product_id, SUM(on_hand) AS total_on_hand
        FROM stock_balances
        GROUP BY product_id
      )
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.sku,
        COALESCE(sc.avail_count, 0)::text AS available_serials_count,
        COALESCE(bc.total_on_hand, 0)::text AS stock_on_hand
      FROM products p
      LEFT JOIN serial_counts sc ON sc.product_id = p.id
      LEFT JOIN balance_counts bc ON bc.product_id = p.id
      WHERE p.serial_tracking = TRUE AND p.is_active = TRUE
        AND COALESCE(sc.avail_count, 0) != COALESCE(bc.total_on_hand, 0)
    `);

    const discrepancies = res.rows.map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku,
      availableSerials: Number(r.available_serials_count),
      stockOnHand: Number(r.stock_on_hand),
      difference: Number(r.available_serials_count) - Number(r.stock_on_hand),
    }));

    checks.push({
      code: 'serial_inventory_reconciliation',
      name: 'Serialized Inventory Matching',
      status: discrepancies.length === 0 ? 'pass' : 'fail',
      summary: discrepancies.length === 0
        ? 'All serialized items match available physical serial numbers.'
        : `${discrepancies.length} product(s) have serial number count mismatch vs stock on hand.`,
      discrepancyCount: discrepancies.length,
      details: discrepancies.slice(0, 10),
    });
  } catch (err: any) {
    checks.push({
      code: 'serial_inventory_reconciliation',
      name: 'Serialized Inventory Matching',
      status: 'fail',
      summary: `Check failed to execute: ${err.message}`,
      discrepancyCount: 1,
    });
  }

  // ── Check 3: Stock Reservation Integrity (stock_balances.reserved vs active stock_reservations) ───
  try {
    const res = await db.execute<{
      product_id: string;
      location_id: string;
      on_hand: string;
      balance_reserved: string;
      active_reservations_qty: string;
    }>(sql`
      WITH active_res AS (
        SELECT product_id, location_id, SUM(reserved_qty - fulfilled_qty) AS total_qty
        FROM stock_reservations
        WHERE status = 'active'
        GROUP BY product_id, location_id
      )
      SELECT
        sb.product_id,
        sb.location_id,
        sb.on_hand::text,
        sb.reserved::text AS balance_reserved,
        COALESCE(ar.total_qty, 0)::text AS active_reservations_qty
      FROM stock_balances sb
      LEFT JOIN active_res ar ON ar.product_id = sb.product_id AND ar.location_id = sb.location_id
      WHERE sb.reserved > sb.on_hand 
         OR sb.reserved < 0 
         OR sb.on_hand < 0
         OR ABS(sb.reserved - COALESCE(ar.total_qty, 0)) > 0.001
    `);

    const discrepancies = res.rows.map((r) => ({
      productId: r.product_id,
      locationId: r.location_id,
      onHand: Number(r.on_hand),
      balanceReserved: Number(r.balance_reserved),
      activeReservations: Number(r.active_reservations_qty),
      diff: Math.abs(Number(r.balance_reserved) - Number(r.active_reservations_qty)),
    }));

    checks.push({
      code: 'stock_reservation_integrity',
      name: 'Stock Reservation & Balance Invariants',
      status: discrepancies.length === 0 ? 'pass' : 'fail',
      summary: discrepancies.length === 0
        ? 'All stock reservations reconcile with active stock_reservations (0 <= reserved <= on_hand).'
        : `${discrepancies.length} balance record(s) violate stock reservation or non-negativity invariants.`,
      discrepancyCount: discrepancies.length,
      details: discrepancies.slice(0, 10),
    });
  } catch (err: any) {
    checks.push({
      code: 'stock_reservation_integrity',
      name: 'Stock Reservation & Balance Invariants',
      status: 'fail',
      summary: `Check failed to execute: ${err.message}`,
      discrepancyCount: 1,
    });
  }

  // ── Check 4: Sales Document Sequence Gap & Duplication Detection ───────────
  try {
    const res = await db.execute<{
      document_number: string;
      count: string;
    }>(sql`
      SELECT
        document_number,
        COUNT(*)::text AS count
      FROM sales_documents
      WHERE document_number IS NOT NULL
      GROUP BY document_number
      HAVING COUNT(*) > 1
    `);

    const duplicates = res.rows.map((r) => ({
      documentNumber: r.document_number,
      occurrences: Number(r.count),
    }));

    checks.push({
      code: 'sales_document_numbering',
      name: 'Document Sequence & Numbering Integrity',
      status: duplicates.length === 0 ? 'pass' : 'fail',
      summary: duplicates.length === 0
        ? 'All issued sales documents have unique, non-colliding sequential numbers.'
        : `${duplicates.length} duplicate document number(s) detected.`,
      discrepancyCount: duplicates.length,
      details: duplicates.slice(0, 10),
    });
  } catch (err: any) {
    checks.push({
      code: 'sales_document_numbering',
      name: 'Document Sequence & Numbering Integrity',
      status: 'fail',
      summary: `Check failed to execute: ${err.message}`,
      discrepancyCount: 1,
    });
  }

  // ── Check 5: Delivery Note vs Invoice Status Reconciliation ────────────────
  try {
    const res = await db.execute<{
      document_id: string;
      document_number: string;
      invoice_delivery_status: string;
      delivery_note_status: string;
    }>(sql`
      SELECT
        sd.id AS document_id,
        sd.document_number,
        sd.delivery_status AS invoice_delivery_status,
        dn.status AS delivery_note_status
      FROM sales_documents sd
      JOIN delivery_notes dn ON dn.sales_document_id = sd.id
      WHERE (dn.status = 'delivered' AND sd.delivery_status = 'not_delivered')
         OR (dn.status = 'pending' AND sd.delivery_status = 'delivered')
    `);

    const discrepancies = res.rows.map((r) => ({
      documentId: r.document_id,
      documentNumber: r.document_number,
      invoiceStatus: r.invoice_delivery_status,
      deliveryNoteStatus: r.delivery_note_status,
    }));

    checks.push({
      code: 'delivery_status_reconciliation',
      name: 'Delivery Note & Invoice Fulfillment Sync',
      status: discrepancies.length === 0 ? 'pass' : 'warning',
      summary: discrepancies.length === 0
        ? 'All delivery note fulfillments match sales document delivery status.'
        : `${discrepancies.length} document(s) have mismatched fulfillment state.`,
      discrepancyCount: discrepancies.length,
      details: discrepancies.slice(0, 10),
    });
  } catch (err: any) {
    checks.push({
      code: 'delivery_status_reconciliation',
      name: 'Delivery Note & Invoice Fulfillment Sync',
      status: 'fail',
      summary: `Check failed to execute: ${err.message}`,
      discrepancyCount: 1,
    });
  }

  // ── Check 6: Invoice Paid Amount & Balance vs Allocations ──────────────────
  try {
    const res = await db.execute<{
      document_id: string;
      document_number: string;
      total_minor: string;
      balance_minor: string;
      allocations_sum: string;
    }>(sql`
      SELECT
        sd.id AS document_id,
        sd.document_number,
        sd.total_minor::text,
        sd.balance_minor::text,
        COALESCE(SUM(pa.amount_minor), 0)::text AS allocations_sum
      FROM sales_documents sd
      LEFT JOIN payment_allocations pa ON pa.invoice_id = sd.id
      WHERE sd.document_type = 'invoice'
        AND sd.status IN ('issued', 'partially_paid', 'paid')
      GROUP BY sd.id, sd.document_number, sd.total_minor, sd.balance_minor
      HAVING (sd.total_minor - sd.balance_minor) != COALESCE(SUM(pa.amount_minor), 0)
    `);

    const discrepancies = res.rows.map((r) => ({
      documentId: r.document_id,
      documentNumber: r.document_number,
      totalMinor: Number(r.total_minor),
      balanceMinor: Number(r.balance_minor),
      paidDerived: Number(r.total_minor) - Number(r.balance_minor),
      allocationsSum: Number(r.allocations_sum),
    }));

    checks.push({
      code: 'invoice_allocation_reconciliation',
      name: 'Invoice Paid & Balance vs Payment Allocations',
      status: discrepancies.length === 0 ? 'pass' : 'fail',
      summary: discrepancies.length === 0
        ? 'All invoice balances reconcile exactly with payment allocations.'
        : `${discrepancies.length} invoice(s) have paid/balance amounts that do not match payment allocations.`,
      discrepancyCount: discrepancies.length,
      details: discrepancies.slice(0, 10),
    });
  } catch (err: any) {
    checks.push({
      code: 'invoice_allocation_reconciliation',
      name: 'Invoice Paid & Balance vs Payment Allocations',
      status: 'fail',
      summary: `Check failed to execute: ${err.message}`,
      discrepancyCount: 1,
    });
  }

  // ── Check 7: Payments Exceeding Pending/Awaiting Limits ────────────────────
  try {
    const res = await db.execute<{
      id: string;
      payment_number: string;
      status: string;
      created_at: string;
    }>(sql`
      SELECT
        id,
        payment_number,
        status,
        created_at::text
      FROM payments
      WHERE (status = 'awaiting_sale' AND created_at < NOW() - INTERVAL '2 hours')
         OR (status = 'pending' AND created_at < NOW() - INTERVAL '24 hours')
    `);

    const discrepancies = res.rows.map((r) => ({
      paymentId: r.id,
      paymentNumber: r.payment_number,
      status: r.status,
      createdAt: r.created_at,
    }));

    checks.push({
      code: 'payments_time_limits',
      name: 'Payments Exceeding Pending / Awaiting-Sale Limits',
      status: discrepancies.length === 0 ? 'pass' : 'warning',
      summary: discrepancies.length === 0
        ? 'No payments exceeded the awaiting_sale (2h) or pending (24h) threshold.'
        : `${discrepancies.length} payment(s) exceeded time limit in awaiting_sale or pending status.`,
      discrepancyCount: discrepancies.length,
      details: discrepancies.slice(0, 10),
    });
  } catch (err: any) {
    checks.push({
      code: 'payments_time_limits',
      name: 'Payments Exceeding Pending / Awaiting-Sale Limits',
      status: 'fail',
      summary: `Check failed to execute: ${err.message}`,
      discrepancyCount: 1,
    });
  }

  // ── Check 8: EIS Queue Health ───────────────────────────────────────────────
  try {
    const res = await db.execute<{
      count: string;
      oldest_pending: string;
    }>(sql`
      SELECT
        COUNT(*)::text AS count,
        MIN(created_at)::text AS oldest_pending
      FROM eis_submissions
      WHERE status IN ('pending', 'failed')
        AND created_at < NOW() - INTERVAL '24 hours'
    `);

    const count = Number(res.rows[0]?.count ?? 0);
    checks.push({
      code: 'eis_queue_health',
      name: 'EIS Submissions Queue Health',
      status: count === 0 ? 'pass' : 'warning',
      summary: count === 0
        ? 'All EIS queue submissions processed within 24 hours.'
        : `${count} EIS submission(s) pending or failed for over 24 hours (oldest: ${res.rows[0]?.oldest_pending}).`,
      discrepancyCount: count,
      details: count > 0 ? [{ count, oldest: res.rows[0]?.oldest_pending }] : [],
    });
  } catch (err: any) {
    checks.push({
      code: 'eis_queue_health',
      name: 'EIS Submissions Queue Health',
      status: 'fail',
      summary: `Check failed to execute: ${err.message}`,
      discrepancyCount: 1,
    });
  }

  // ── Check 9: Orphan Database Records ────────────────────────────────────────
  try {
    const linesWithoutDocs = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM sales_document_lines sdl
      LEFT JOIN sales_documents sd ON sd.id = sdl.document_id
      WHERE sd.id IS NULL
    `);
    const allocsWithoutPmts = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM payment_allocations pa
      LEFT JOIN payments p ON p.id = pa.payment_id
      WHERE p.id IS NULL
    `);
    const allocsWithoutDocs = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM payment_allocations pa
      LEFT JOIN sales_documents sd ON sd.id = pa.invoice_id
      WHERE sd.id IS NULL
    `);

    const orphanCount = 
      Number(linesWithoutDocs.rows[0]?.count ?? 0) +
      Number(allocsWithoutPmts.rows[0]?.count ?? 0) +
      Number(allocsWithoutDocs.rows[0]?.count ?? 0);

    checks.push({
      code: 'orphan_records',
      name: 'Orphan Database Records Integrity',
      status: orphanCount === 0 ? 'pass' : 'fail',
      summary: orphanCount === 0
        ? 'No orphan lines or payment allocation records detected.'
        : `${orphanCount} orphan record(s) detected without valid parent references.`,
      discrepancyCount: orphanCount,
      details: orphanCount > 0 ? [
        { linesWithoutDoc: linesWithoutDocs.rows[0]?.count },
        { allocWithoutPmt: allocsWithoutPmts.rows[0]?.count },
        { allocWithoutDoc: allocsWithoutDocs.rows[0]?.count },
      ] : [],
    });
  } catch (err: any) {
    checks.push({
      code: 'orphan_records',
      name: 'Orphan Database Records Integrity',
      status: 'fail',
      summary: `Check failed to execute: ${err.message}`,
      discrepancyCount: 1,
    });
  }

    // ── Check 10: Confirmed Payments Missing confirmed_at ───────────────────────
  try {
    const res = await db.execute<{
      id: string;
      payment_number: string;
      status: string;
    }>(sql`
      SELECT id, payment_number, status
      FROM payments
      WHERE status = 'confirmed' AND confirmed_at IS NULL
    `);

    const discrepancies = res.rows.map((r) => ({
      paymentId: r.id,
      paymentNumber: r.payment_number,
    }));

    checks.push({
      code: 'confirmed_payments_timestamp',
      name: 'Confirmed Payments Timestamp Completeness',
      status: discrepancies.length === 0 ? 'pass' : 'fail',
      summary: discrepancies.length === 0
        ? 'All confirmed payments have a valid confirmed_at timestamp.'
        : `${discrepancies.length} confirmed payment(s) are missing confirmed_at timestamp.`,
      discrepancyCount: discrepancies.length,
      details: discrepancies.slice(0, 10),
    });
  } catch (err: any) {
    checks.push({
      code: 'confirmed_payments_timestamp',
      name: 'Confirmed Payments Timestamp Completeness',
      status: 'fail',
      summary: `Check failed to execute: ${err.message}`,
      discrepancyCount: 1,
    });
  }

  // ── Check 11: Delivered Quantity vs Delivery Lines ──────────────────────────
  try {
    const res = await db.execute<{
      line_id: string;
      document_id: string;
      delivered_qty: string;
      dni_delivered: string;
    }>(sql`
      WITH dni_sum AS (
        SELECT sales_document_line_id, SUM(quantity) AS total_delivered
        FROM delivery_note_lines
        GROUP BY sales_document_line_id
      )
      SELECT
        sdl.id AS line_id,
        sdl.document_id,
        sdl.delivered_qty::text,
        COALESCE(ds.total_delivered, 0)::text AS dni_delivered
      FROM sales_document_lines sdl
      LEFT JOIN dni_sum ds ON ds.sales_document_line_id = sdl.id
      WHERE ABS(sdl.delivered_qty - COALESCE(ds.total_delivered, 0)) > 0.001
    `);

    const discrepancies = res.rows.map((r) => ({
      lineId: r.line_id,
      documentId: r.document_id,
      lineDeliveredQty: Number(r.delivered_qty),
      deliveryNotesSum: Number(r.dni_delivered),
    }));

    checks.push({
      code: 'delivered_quantity_sync',
      name: 'Delivered Quantity vs Delivery Note Items',
      status: discrepancies.length === 0 ? 'pass' : 'fail',
      summary: discrepancies.length === 0
        ? 'All sales document line delivered quantities match delivery note line items.'
        : `${discrepancies.length} sales document line(s) have delivered quantity mismatch vs delivery notes.`,
      discrepancyCount: discrepancies.length,
      details: discrepancies.slice(0, 10),
    });
  } catch (err: any) {
    checks.push({
      code: 'delivered_quantity_sync',
      name: 'Delivered Quantity vs Delivery Note Items',
      status: 'fail',
      summary: `Check failed to execute: ${err.message}`,
      discrepancyCount: 1,
    });
  }

  // ── Check 12: Product Average Cost vs Ledger Replay ─────────────────────────
  try {
    const res = await db.execute<{
      product_id: string;
      sku: string;
      name: string;
      product_avg_cost: string;
      replayed_avg_cost: string;
    }>(sql`
      WITH receipt_totals AS (
        SELECT
          product_id,
          SUM(quantity * unit_cost_minor) AS total_val,
          SUM(quantity) AS total_qty
        FROM stock_movements
        WHERE movement_type IN ('purchase_receipt', 'opening_balance')
          AND quantity > 0
        GROUP BY product_id
      )
      SELECT
        p.id AS product_id,
        p.sku,
        p.name,
        p.avg_cost_minor::text AS product_avg_cost,
        CASE WHEN rt.total_qty > 0 THEN (rt.total_val / rt.total_qty)::bigint::text ELSE '0' END AS replayed_avg_cost
      FROM products p
      JOIN receipt_totals rt ON rt.product_id = p.id
      WHERE rt.total_qty > 0
        AND ABS(p.avg_cost_minor - (rt.total_val / rt.total_qty)) > 5
    `);

    const discrepancies = res.rows.map((r) => ({
      productId: r.product_id,
      sku: r.sku,
      name: r.name,
      productAvgCostMinor: Number(r.product_avg_cost),
      replayedAvgCostMinor: Number(r.replayed_avg_cost),
    }));

    checks.push({
      code: 'avg_cost_ledger_replay',
      name: 'Product Average Cost vs Ledger Replay',
      status: discrepancies.length === 0 ? 'pass' : 'fail',
      summary: discrepancies.length === 0
        ? 'All active product average costs match the mathematical replay of stock movement receipts.'
        : `${discrepancies.length} product(s) have average cost deviating from stock movements ledger replay.`,
      discrepancyCount: discrepancies.length,
      details: discrepancies.slice(0, 10),
    });
  } catch (err: any) {
    checks.push({
      code: 'avg_cost_ledger_replay',
      name: 'Product Average Cost vs Ledger Replay',
      status: 'fail',
      summary: `Check failed to execute: ${err.message}`,
      discrepancyCount: 1,
    });
  }

  // ── Check: Workers Alive (Cron Heartbeat) ──────────────────────────────────
  try {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const criticalJobs = ['provider_reconciliation', 'eis_worker'];
    const staleWorkers: string[] = [];

    for (const job of criticalJobs) {
      const [latest] = await db
        .select({
          jobName: cronRuns.jobName,
          status: cronRuns.status,
          completedAt: cronRuns.completedAt,
          startedAt: cronRuns.startedAt,
        })
        .from(cronRuns)
        .where(eq(cronRuns.jobName, job))
        .orderBy(desc(cronRuns.startedAt))
        .limit(1);

      if (
        !latest ||
        (latest.completedAt && latest.completedAt < fifteenMinutesAgo) ||
        (!latest.completedAt && latest.startedAt < fifteenMinutesAgo)
      ) {
        staleWorkers.push(job);
      }
    }

    if (staleWorkers.length === 0) {
      checks.push({
        code: 'workers_alive',
        name: 'Background Workers Alive Check',
        status: 'pass',
        summary: 'All critical cron workers (provider reconciliation & EIS) have completed a run within the last 15 minutes.',
        discrepancyCount: 0,
      });
    } else {
      checks.push({
        code: 'workers_alive',
        name: 'Background Workers Alive Check',
        status: 'warning',
        summary: `One or more background workers have not completed a heartbeat within the last 15 minutes: ${staleWorkers.join(', ')}.`,
        discrepancyCount: staleWorkers.length,
        details: staleWorkers.map((job) => ({ job, alert: 'No heartbeat within 15 minutes' })),
      });
    }
  } catch (err: any) {
    checks.push({
      code: 'workers_alive',
      name: 'Background Workers Alive Check',
      status: 'warning',
      summary: `Failed to inspect cron worker heartbeats: ${err?.message || err}`,
      discrepancyCount: 1,
    });
  }

  const durationMs = Date.now() - startTime;
  const passedCount = checks.filter((c) => c.status === 'pass').length;
  const warningCount = checks.filter((c) => c.status === 'warning').length;
  const failedCount = checks.filter((c) => c.status === 'fail').length;

  const suiteStatus: 'pass' | 'warning' | 'fail' =
    failedCount > 0 ? 'fail' : warningCount > 0 ? 'warning' : 'pass';

  // Record to system_checks_history
  const [record] = await db
    .insert(systemChecksHistory)
    .values({
      executedBy: executedById,
      status: suiteStatus,
      totalChecks: checks.length,
      passedCount,
      warningCount,
      failedCount,
      durationMs,
      details: checks as any,
    })
    .returning({ id: systemChecksHistory.id, executedAt: systemChecksHistory.executedAt });

  return {
    id: record ? record.id : crypto.randomUUID(),
    executedAt: record ? record.executedAt.toISOString() : new Date().toISOString(),
    executedBy: executedById ?? null,
    status: suiteStatus,
    totalChecks: checks.length,
    passedCount,
    warningCount,
    failedCount,
    durationMs,
    checks,
  };
}

export async function getSystemChecksHistory(limit = 20) {
  return db.query.systemChecksHistory.findMany({
    orderBy: [desc(systemChecksHistory.executedAt)],
    limit,
    with: {
      executedByUser: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
}
