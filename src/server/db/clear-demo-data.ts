/**
 * clear-demo-data.ts
 *
 * Removes all transactional / demo data from the database while preserving
 * operational configuration:
 *   ✓ KEPT : roles, users (admin), locations, settings, tax_rates,
 *            number_sequences (reset to 0), account_mappings,
 *            units_of_measure, and the system Walk-in customer ('WALK-IN').
 *   ✗ WIPED: everything else – demo customers, products, suppliers, orders,
 *            stock, sales, payments, accounting entries, POS, integrations, audit log …
 *
 * Usage:
 *   npx tsx src/server/db/clear-demo-data.ts
 */

import 'dotenv/config';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL is not set. Add it to your .env file.');
  process.exit(1);
}

// Ordered list of tables to wipe (children before parents, CASCADE enabled)
const TRUNCATE_TABLES: string[] = [
  // ── Integrations ──────────────────────────────────────────────────────────
  'reconciliation_matches',
  'statement_lines',
  'statement_imports',
  'statement_mapping_profiles',
  'eis_submissions',
  'payment_link_rate_limits',
  'payment_attempts',
  'webhook_inbox',
  'payment_links',

  // ── Accounting ────────────────────────────────────────────────────────────
  'journal_lines',
  'journal_batches',
  'journal_source_events',
  'stock_daily_snapshots',
  'system_checks_history',

  // ── Payments ──────────────────────────────────────────────────────────────
  'payment_allocations',
  'payments',
  'card_terminals',

  // ── POS ───────────────────────────────────────────────────────────────────
  'held_sales',
  'cash_movements',
  'pos_shifts',

  // ── Sales ─────────────────────────────────────────────────────────────────
  'delivery_note_lines',
  'delivery_notes',
  'sales_document_lines',
  'sales_documents',
  'quotation_lines',
  'quotations',
  'stock_reservations',

  // ── Purchasing & Stock ────────────────────────────────────────────────────
  'goods_receipt_items',
  'landed_costs',
  'goods_receipts',
  'purchase_order_items',
  'purchase_orders',
  'suppliers',

  'stock_count_items',
  'stock_counts',
  'stock_adjustment_items',
  'stock_adjustments',
  'serial_numbers',
  'stock_movements',
  'stock_balances',
  'product_bundles',
  'products',
  'categories',

  // ── Setup (transactional only) ────────────────────────────────────────────
  'attachments',
  'login_attempts',
  'audit_log',
  'exchange_rates',
];

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  console.log('\n⚠️   ACE HOLDINGS – DEMO DATA WIPE');
  console.log('══════════════════════════════════════════════════');
  console.log('This will permanently delete ALL transactional data.');
  console.log('The following will be PRESERVED:');
  console.log('  • roles & permissions');
  console.log('  • users (admin account)');
  console.log('  • locations');
  console.log('  • settings');
  console.log('  • tax_rates');
  console.log('  • number_sequences (counters reset to 0)');
  console.log('  • account_mappings');
  console.log('  • system Walk-in customer (account: WALK-IN)');
  console.log('══════════════════════════════════════════════════\n');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Discover all user-defined triggers (non-internal, avoiding system RI constraints)
    console.log('▶ Inspecting user triggers...');
    const triggersRes = await client.query<{
      table_name: string;
      trigger_name: string;
    }>(`
      SELECT c.relname as table_name, t.tgname as trigger_name
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE NOT t.tgisinternal
        AND n.nspname = 'public';
    `);

    const userTriggers = triggersRes.rows;
    console.log(`  Found ${userTriggers.length} user triggers.`);

    // Disable all user triggers
    console.log('▶ Temporarily disabling user triggers...');
    for (const { table_name, trigger_name } of userTriggers) {
      try {
        await client.query(
          `ALTER TABLE "${table_name}" DISABLE TRIGGER "${trigger_name}"`
        );
      } catch (err: unknown) {
        console.warn(`  ! Could not disable trigger ${trigger_name} on ${table_name}:`, (err as Error).message);
      }
    }

    // 2. Truncate all transactional tables
    console.log('\n▶ Truncating transactional tables...');
    for (const table of TRUNCATE_TABLES) {
      try {
        await client.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
        console.log(`  ✓ Truncated ${table}`);
      } catch (err: unknown) {
        const pgErr = err as { code?: string; message?: string };
        if (pgErr.code === '42P01') {
          console.log(`  – Skipped ${table} (table does not exist)`);
        } else {
          throw err;
        }
      }
    }

    // 3. Clean customers table: delete all non-walk-in customers
    console.log('\n▶ Cleaning customers (preserving Walk-in customer)...');
    const deleteCustResult = await client.query(
      `DELETE FROM customers WHERE is_walk_in = FALSE OR is_walk_in IS NULL`
    );
    console.log(`  ✓ Removed ${deleteCustResult.rowCount ?? 0} non-walk-in customers`);

    // 4. Reset number sequences so document numbers restart from 1
    console.log('\n▶ Resetting document number sequences...');
    const seqResult = await client.query<{ id: string; doc_type: string; prefix: string }>(
      `SELECT id, doc_type, prefix FROM number_sequences`
    );
    for (const row of seqResult.rows) {
      await client.query(
        `UPDATE number_sequences SET next_number = 1 WHERE id = $1`,
        [row.id]
      );
      console.log(`  ↺ Reset sequence: ${row.doc_type} (${row.prefix}) -> 1`);
    }

    // 5. Re-enable all user triggers
    console.log('\n▶ Re-enabling user triggers...');
    for (const { table_name, trigger_name } of userTriggers) {
      try {
        await client.query(
          `ALTER TABLE "${table_name}" ENABLE TRIGGER "${trigger_name}"`
        );
      } catch (err: unknown) {
        console.warn(`  ! Could not re-enable trigger ${trigger_name} on ${table_name}:`, (err as Error).message);
      }
    }

    await client.query('COMMIT');

    console.log('\n✅  All demo data has been successfully removed.');
    console.log('    • Reference data, settings, and admin account are preserved.');
    console.log('    • Document sequences reset to 0 (next number: 1).');
    console.log('    • System Walk-in customer preserved.');
    console.log('    • Ready for clean data entry.\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌  Error during cleanup – transaction rolled back.');
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
