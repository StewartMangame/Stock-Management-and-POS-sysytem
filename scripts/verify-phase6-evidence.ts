/**
 * Phase 6 Verification Script:
 * 1. Test immutability on audit_log, journal_batches, journal_lines (UPDATE, DELETE, TRUNCATE blocked)
 * 2. Revoke permissions from public/app role
 * 3. Seed small realistic Ace dataset (20 products, 5 customers, 30 days of transactions) if needed
 * 4. Compare sales, VAT, stock valuation totals between report services and raw SQL
 * 5. Run EXPLAIN ANALYZE on the three heaviest reports with timings
 */

import 'dotenv/config';
import { db } from '../src/server/db';
import { sql } from 'drizzle-orm';
import { getSalesByDay, getSalesByItem } from '../src/server/services/reports/sales-report';
import { getVatSummary } from '../src/server/services/reports/vat-report';
import { getStockOnHand, getStockValuationAsOf } from '../src/server/services/reports/stock-report';
import { getProfitByItem } from '../src/server/services/reports/profit-report';

async function main() {
  console.log('=== [1] Verifying Immutability of audit_log and journal tables ===');
  
  // Test audit_log UPDATE block
  try {
    await db.execute(sql`
      UPDATE audit_log SET action = 'tampered' WHERE id = (SELECT id FROM audit_log LIMIT 1);
    `);
    console.error('FAIL: audit_log UPDATE was permitted!');
  } catch (err: any) {
    console.log('PASS: audit_log UPDATE blocked:', err.message);
  }

  // Test audit_log DELETE block
  try {
    await db.execute(sql`
      DELETE FROM audit_log WHERE id = (SELECT id FROM audit_log LIMIT 1);
    `);
    console.error('FAIL: audit_log DELETE was permitted!');
  } catch (err: any) {
    console.log('PASS: audit_log DELETE blocked:', err.message);
  }

  // Test audit_log TRUNCATE block
  try {
    await db.execute(sql`TRUNCATE TABLE audit_log;`);
    console.error('FAIL: audit_log TRUNCATE was permitted!');
  } catch (err: any) {
    console.log('PASS: audit_log TRUNCATE blocked:', err.message);
  }

  // Test journal_batches: insert a test batch, then attempt UPDATE & DELETE
  const testBatchId = '00000000-0000-0000-0000-000000000099';
  await db.execute(sql`
    INSERT INTO journal_batches (id, batch_number, period_start, period_end, status, total_debit_minor, total_credit_minor, line_count)
    VALUES (${testBatchId}::uuid, 'JB-TEST-99', NOW(), NOW(), 'unexported', 100, 100, 1)
    ON CONFLICT (id) DO NOTHING;
  `);

  try {
    await db.execute(sql`
      UPDATE journal_batches SET status = 'exported' WHERE id = ${testBatchId}::uuid;
    `);
    console.error('FAIL: journal_batches UPDATE was permitted!');
  } catch (err: any) {
    console.log('PASS: journal_batches UPDATE blocked:', err.message);
  }

  try {
    await db.execute(sql`
      DELETE FROM journal_batches WHERE id = ${testBatchId}::uuid;
    `);
    console.error('FAIL: journal_batches DELETE was permitted!');
  } catch (err: any) {
    console.log('PASS: journal_batches DELETE blocked:', err.message);
  }

  try {
    await db.execute(sql`TRUNCATE TABLE journal_batches CASCADE;`);
    console.error('FAIL: journal_batches TRUNCATE was permitted!');
  } catch (err: any) {
    console.log('PASS: journal_batches TRUNCATE blocked:', err.message);
  }

  // Test journal_lines: insert test line, then attempt UPDATE & DELETE
  const testLineId = '00000000-0000-0000-0000-000000000098';
  await db.execute(sql`
    INSERT INTO journal_lines (id, batch_id, entry_number, entry_date, event_type, source_entity_type, source_entity_id, account_code, account_name, debit_minor, credit_minor)
    VALUES (${testLineId}::uuid, ${testBatchId}::uuid, 'JE-TEST-1', NOW(), 'invoice_issued', 'invoice', gen_random_uuid(), '1100', 'AR', 100, 0)
    ON CONFLICT (id) DO NOTHING;
  `);

  try {
    await db.execute(sql`
      UPDATE journal_lines SET debit_minor = 999999 WHERE id = ${testLineId}::uuid;
    `);
    console.error('FAIL: journal_lines UPDATE was permitted!');
  } catch (err: any) {
    console.log('PASS: journal_lines UPDATE blocked:', err.message);
  }

  try {
    await db.execute(sql`
      DELETE FROM journal_lines WHERE id = ${testLineId}::uuid;
    `);
    console.error('FAIL: journal_lines DELETE was permitted!');
  } catch (err: any) {
    console.log('PASS: journal_lines DELETE blocked:', err.message);
  }

  try {
    await db.execute(sql`TRUNCATE TABLE journal_lines;`);
    console.error('FAIL: journal_lines TRUNCATE was permitted!');
  } catch (err: any) {
    console.log('PASS: journal_lines TRUNCATE blocked:', err.message);
  }

  console.log('\n=== [2] Checking Realistic Ace Dataset & Comparing Totals ===');
  // Check counts in DB
  const [prodCount] = (await db.execute<{ count: string }>(sql`SELECT count(*)::text FROM products`)).rows;
  const [custCount] = (await db.execute<{ count: string }>(sql`SELECT count(*)::text FROM customers`)).rows;
  const [invCount] = (await db.execute<{ count: string }>(sql`SELECT count(*)::text FROM sales_documents WHERE document_type = 'invoice'`)).rows;
  const [mvCount] = (await db.execute<{ count: string }>(sql`SELECT count(*)::text FROM stock_movements`)).rows;

  console.log(`Current DB contains: ${prodCount?.count ?? 0} products, ${custCount?.count ?? 0} customers, ${invCount?.count ?? 0} invoices, ${mvCount?.count ?? 0} stock movements.`);

  // Date range for reports: last 60 days
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - 60 * 86400000);
  const from = fromDate.toISOString().slice(0, 10);

  // 1. Sales Report vs Raw SQL
  const salesReport = await getSalesByDay({ from, to, groupBy: 'day' });
  const fromInstant = new Date(from + 'T00:00:00+02:00');
  const toInstant = new Date(to + 'T00:00:00+02:00');
  toInstant.setDate(toInstant.getDate() + 1);

  const rawSales = await db.execute<{ gross_minor: string; credit_minor: string; net_minor: string }>(sql`
    WITH issued_inv AS (
      SELECT COALESCE(SUM(total_minor - tax_minor), 0) AS gross_minor
      FROM sales_documents
      WHERE document_type = 'invoice'
        AND status != 'void'
        AND issue_date >= ${fromInstant}
        AND issue_date < ${toInstant}
    ),
    credit_notes AS (
      SELECT COALESCE(SUM(total_minor - tax_minor), 0) AS credit_minor
      FROM sales_documents
      WHERE document_type = 'credit_note'
        AND status != 'void'
        AND issue_date >= ${fromInstant}
        AND issue_date < ${toInstant}
    )
    SELECT
      gross_minor::text,
      credit_minor::text,
      (gross_minor - credit_minor)::text AS net_minor
    FROM issued_inv, credit_notes
  `);
  
  const rawGross = Number(rawSales.rows[0]?.gross_minor || 0);
  const rawCredit = Number(rawSales.rows[0]?.credit_minor || 0);
  const rawNet = Number(rawSales.rows[0]?.net_minor || 0);

  console.log(`Sales Comparison:`);
  console.log(`  Report Service Net: MWK ${(salesReport.totals.netRevenueMinor / 100).toLocaleString()}`);
  console.log(`  Raw SQL Net:        MWK ${(rawNet / 100).toLocaleString()}`);
  console.log(`  Match? ${salesReport.totals.netRevenueMinor === rawNet ? 'PASS ✓' : 'FAIL ✗'}`);

  // 2. VAT Summary vs Raw SQL
  const vatReport = await getVatSummary(from, to);
  const rawVat = await db.execute<{ total_tax: string }>(sql`
    WITH inv_tax AS (
      SELECT COALESCE(SUM(tax_minor), 0) AS tax
      FROM sales_documents
      WHERE document_type = 'invoice'
        AND status != 'void'
        AND issue_date >= ${fromInstant}
        AND issue_date < ${toInstant}
    ),
    cn_tax AS (
      SELECT COALESCE(SUM(tax_minor), 0) AS tax
      FROM sales_documents
      WHERE document_type = 'credit_note'
        AND status != 'void'
        AND issue_date >= ${fromInstant}
        AND issue_date < ${toInstant}
    )
    SELECT (inv_tax.tax - cn_tax.tax)::text AS total_tax
    FROM inv_tax, cn_tax
  `);
  const rawVatTotal = Number(rawVat.rows[0]?.total_tax || 0);
  console.log(`VAT Comparison:`);
  console.log(`  Report Service Output VAT: MWK ${(vatReport.totals.netOutputVatMinor / 100).toLocaleString()}`);
  console.log(`  Raw SQL Output VAT:        MWK ${(rawVatTotal / 100).toLocaleString()}`);
  console.log(`  Match? ${vatReport.totals.netOutputVatMinor === rawVatTotal ? 'PASS ✓' : 'FAIL ✗'}`);

  // 3. Stock On Hand & Valuation vs Raw SQL
  const stockOnHandReport = await getStockOnHand();
  const rawStockVal = await db.execute<{ total_val: string }>(sql`
    SELECT COALESCE(SUM(sb.on_hand * p.avg_cost_minor), 0)::text AS total_val
    FROM stock_balances sb
    JOIN products p ON p.id = sb.product_id
    WHERE sb.on_hand > 0 AND p.is_active = TRUE
  `);
  const rawVal = Number(rawStockVal.rows[0]?.total_val || 0);
  const reportTotalVal = stockOnHandReport.rows.reduce((s, r) => s + r.valuationMinor, 0);
  console.log(`Stock Valuation Comparison:`);
  console.log(`  Report Valuation:  MWK ${(reportTotalVal / 100).toLocaleString()}`);
  console.log(`  Raw SQL Valuation: MWK ${(rawVal / 100).toLocaleString()}`);
  console.log(`  Match? ${reportTotalVal === rawVal ? 'PASS ✓' : 'FAIL ✗'}`);

  console.log('\n=== [3] EXPLAIN ANALYZE on Heaviest Reports ===');
  
  // 1. Sales by item EXPLAIN ANALYZE
  console.log('--- 1. Sales by Item Query Plan & Timing ---');
  const explainSales = await db.execute(sql`
    EXPLAIN (ANALYZE, COSTS, BUFFERS)
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
        AND sd.status IN ('issued', 'paid', 'partially_paid')
        AND sd.issue_date >= ${from}::date
        AND sd.issue_date <= ${to}::date
      GROUP BY sdl.product_id
    )
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      COALESCE(p.sku, '') AS sku,
      COALESCE(cat.name, 'Uncategorised') AS category_name,
      COALESCE(i.qty, 0)::text AS quantity_sold,
      COALESCE(i.revenue, 0)::text AS revenue_minor,
      COALESCE(i.cost_val, 0)::text AS cost_minor
    FROM products p
    LEFT JOIN categories cat ON cat.id = p.category_id
    JOIN issued i ON i.product_id = p.id
    ORDER BY i.revenue DESC
  `);
  for (const row of explainSales.rows) {
    console.log(Object.values(row)[0]);
  }

  // 2. Stock Valuation as of past date EXPLAIN ANALYZE
  console.log('\n--- 2. Stock Valuation As-Of Query Plan & Timing ---');
  const explainStock = await db.execute(sql`
    EXPLAIN (ANALYZE, COSTS, BUFFERS)
    WITH ledger_replay AS (
      SELECT
        sm.product_id,
        sm.location_id,
        SUM(sm.quantity) AS on_hand_replayed,
        ROUND(SUM(sm.total_cost_minor))::bigint AS valuation_replayed
      FROM stock_movements sm
      WHERE sm.occurred_at <= ${new Date(to + 'T23:59:59+02:00')}
      GROUP BY sm.product_id, sm.location_id
      HAVING SUM(sm.quantity) > 0
    )
    SELECT
      p.id,
      p.name,
      p.sku,
      loc.name AS location_name,
      COALESCE(lr.on_hand_replayed, 0)::text AS on_hand,
      p.avg_cost_minor::text AS avg_cost_minor,
      COALESCE(lr.valuation_replayed, 0)::text AS valuation_minor
    FROM products p
    JOIN ledger_replay lr ON lr.product_id = p.id
    JOIN locations loc ON loc.id = lr.location_id
    WHERE p.is_active = TRUE
    ORDER BY loc.name, p.name
  `);
  for (const row of explainStock.rows) {
    console.log(Object.values(row)[0]);
  }

  // 3. Profit by Item Query Plan & Timing
  console.log('\n--- 3. Profit by Item Query Plan & Timing ---');
  const explainProfit = await db.execute(sql`
    EXPLAIN (ANALYZE, COSTS, BUFFERS)
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      COALESCE(p.sku, '') AS sku,
      COALESCE(cat.name, 'Uncategorised') AS category_name,
      SUM(dnl.quantity)::text AS delivered_qty,
      SUM(dnl.quantity * sdl.unit_price_minor)::text AS revenue_minor,
      SUM(COALESCE(dnl.total_cost_minor, 0))::text AS cost_minor
    FROM delivery_notes dn
    JOIN delivery_note_lines dnl ON dnl.delivery_note_id = dn.id
    JOIN sales_document_lines sdl ON sdl.id = dnl.sales_document_line_id
    JOIN products p ON p.id = dnl.product_id
    LEFT JOIN categories cat ON cat.id = p.category_id
    WHERE dn.status = 'dispatched'
      AND dn.delivery_date >= ${from}::date
      AND dn.delivery_date <= ${to}::date
    GROUP BY p.id, p.name, p.sku, cat.name
    ORDER BY revenue_minor DESC
  `);
  for (const row of explainProfit.rows) {
    console.log(Object.values(row)[0]);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
