const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '../src/server/services/system-checks.ts');
let content = fs.readFileSync(targetPath, 'utf8');

// First truncate from line "// -- Check 10" or "// ── Check 10" if present
const idx10 = content.indexOf('// ── Check 10');
const idx10Alt = content.indexOf('// -- Check 10');
const cutIdx = idx10 !== -1 ? idx10 : idx10Alt;

let beforePart = content;
if (cutIdx !== -1) {
  beforePart = content.slice(0, cutIdx);
} else {
  const durationIdx = beforePart.indexOf('const durationMs = Date.now() - startTime;');
  beforePart = beforePart.slice(0, durationIdx);
}

const newChecks = `  // ── Check 10: Confirmed Payments Missing confirmed_at ───────────────────────
  try {
    const res = await db.execute<{
      id: string;
      payment_number: string;
      status: string;
    }>(sql\`
      SELECT id, payment_number, status
      FROM payments
      WHERE status = 'confirmed' AND confirmed_at IS NULL
    \`);

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
        : \`\${discrepancies.length} confirmed payment(s) are missing confirmed_at timestamp.\`,
      discrepancyCount: discrepancies.length,
      details: discrepancies.slice(0, 10),
    });
  } catch (err: any) {
    checks.push({
      code: 'confirmed_payments_timestamp',
      name: 'Confirmed Payments Timestamp Completeness',
      status: 'fail',
      summary: \`Check failed to execute: \${err.message}\`,
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
    }>(sql\`
      WITH dni_sum AS (
        SELECT sales_document_line_id, SUM(quantity) AS total_delivered
        FROM delivery_note_items
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
    \`);

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
        : \`\${discrepancies.length} sales document line(s) have delivered quantity mismatch vs delivery notes.\`,
      discrepancyCount: discrepancies.length,
      details: discrepancies.slice(0, 10),
    });
  } catch (err: any) {
    checks.push({
      code: 'delivered_quantity_sync',
      name: 'Delivered Quantity vs Delivery Note Items',
      status: 'fail',
      summary: \`Check failed to execute: \${err.message}\`,
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
    }>(sql\`
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
    \`);

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
        : \`\${discrepancies.length} product(s) have average cost deviating from stock movements ledger replay.\`,
      discrepancyCount: discrepancies.length,
      details: discrepancies.slice(0, 10),
    });
  } catch (err: any) {
    checks.push({
      code: 'avg_cost_ledger_replay',
      name: 'Product Average Cost vs Ledger Replay',
      status: 'fail',
      summary: \`Check failed to execute: \${err.message}\`,
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
`;

fs.writeFileSync(targetPath, beforePart + newChecks, 'utf8');
console.log('Successfully patched system-checks.ts');

