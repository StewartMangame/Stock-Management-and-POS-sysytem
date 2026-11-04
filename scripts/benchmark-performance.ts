import 'dotenv/config';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function main() {
  const testDbUrl = process.env.DATABASE_URL_TEST || process.env.TEST_DATABASE_URL;
  if (!testDbUrl) {
    throw new Error('DATABASE_URL_TEST or TEST_DATABASE_URL is required for performance benchmark');
  }

  console.log('Connecting to test database for EXPLAIN ANALYZE benchmark...');
  const pool = new Pool({ connectionString: testDbUrl });

  // 1. Seed base fixtures if missing
  console.log('Ensuring base entities exist in testdb...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Role
    await client.query(`
      INSERT INTO roles (id, name, permissions)
      VALUES ('00000000-0000-0000-0000-000000000001', 'admin', ARRAY['*'])
      ON CONFLICT (id) DO NOTHING;
    `);

    // 1 user
    await client.query(`
      INSERT INTO users (id, name, email, password_hash, role_id, is_active)
      VALUES ('00000000-0000-0000-0000-000000000002', 'Bench Admin', 'admin@benchmark.local', 'hash', '00000000-0000-0000-0000-000000000001', true)
      ON CONFLICT (id) DO NOTHING;
    `);

    // 1 location
    await client.query(`
      INSERT INTO locations (id, code, name, type, is_active)
      VALUES ('00000000-0000-0000-0000-000000000003', 'BENCH-LOC', 'Benchmark Warehouse', 'warehouse', true)
      ON CONFLICT (id) DO NOTHING;
    `);

    // 10 categories
    await client.query(`
      INSERT INTO categories (id, name, code)
      SELECT 
        ('00000000-0000-0000-0001-' || LPAD(i::text, 12, '0'))::uuid,
        'Cat ' || i,
        'CAT-' || i
      FROM generate_series(1, 10) i
      ON CONFLICT (id) DO NOTHING;
    `);

    // 1 UOM
    await client.query(`
      INSERT INTO units_of_measure (id, name, code, symbol)
      VALUES ('00000000-0000-0000-0000-000000000010', 'Pieces', 'PCS', 'pcs')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 1 Tax Rate
    await client.query(`
      INSERT INTO tax_rates (id, name, rate_basis_points, is_default, is_active)
      VALUES ('00000000-0000-0000-0000-000000000020', 'Standard VAT 17.5%', 1750, true, true)
      ON CONFLICT (id) DO NOTHING;
    `);

    // 50 products
    await client.query(`
      INSERT INTO products (id, sku, name, product_type, category_id, uom_id, tax_rate_id, avg_cost_minor, selling_price_minor, is_active)
      SELECT 
        ('00000000-0000-0000-0002-' || LPAD(i::text, 12, '0'))::uuid,
        'SKU-' || i,
        'Benchmark Product ' || i,
        'standard',
        ('00000000-0000-0000-0001-' || LPAD(((i % 10) + 1)::text, 12, '0'))::uuid,
        '00000000-0000-0000-0000-000000000010'::uuid,
        '00000000-0000-0000-0000-000000000020'::uuid,
        100000,
        150000,
        true
      FROM generate_series(1, 50) i
      ON CONFLICT (id) DO NOTHING;
    `);

    // 20 customers
    await client.query(`
      INSERT INTO customers (id, customer_type, name, account_number, is_active)
      SELECT 
        ('00000000-0000-0000-0003-' || LPAD(i::text, 12, '0'))::uuid,
        'business',
        'Benchmark Customer ' || i,
        'CUST-' || i,
        true
      FROM generate_series(1, 20) i
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('Base entities ready.');

    // 2. Check counts of stock_movements and sales_documents
    const curSm = await client.query('SELECT COUNT(*)::int AS count FROM stock_movements');
    const curSd = await client.query('SELECT COUNT(*)::int AS count FROM sales_documents');
    console.log(`Current testdb counts: ${curSm.rows[0].count} stock movements, ${curSd.rows[0].count} sales documents.`);

    if (curSm.rows[0].count < 50000) {
      const neededSm = 50000 - curSm.rows[0].count;
      console.log(`Generating ${neededSm} stock movements...`);
      await client.query(`
        INSERT INTO stock_movements (
          id, product_id, location_id, movement_type, reference_type, quantity, unit_cost_minor, total_cost_minor, occurred_at, created_by
        )
        SELECT
          gen_random_uuid(),
          ('00000000-0000-0000-0002-' || LPAD(((i % 50) + 1)::text, 12, '0'))::uuid,
          '00000000-0000-0000-0000-000000000003'::uuid,
          'opening',
          'opening_stock',
          (i % 10) + 1,
          100000,
          ((i % 10) + 1) * 100000,
          NOW() - (INTERVAL '1 minute' * (i % 43200)), -- distributed over last 30 days
          '00000000-0000-0000-0000-000000000002'::uuid
        FROM generate_series(1, ${neededSm}) i;
      `);
      console.log('50,000 stock movements generated.');
    }

    if (curSd.rows[0].count < 20000) {
      const neededSd = 20000 - curSd.rows[0].count;
      console.log(`Generating ${neededSd} invoices and invoice lines...`);
      // First insert as draft
      await client.query(`
        INSERT INTO sales_documents (
          id, document_type, document_number, status, payment_status, delivery_status, customer_id, location_id, created_by,
          subtotal_minor, tax_minor, total_minor, balance_minor, issue_date, due_date, channel
        )
        SELECT
          ('00000000-0000-0000-0004-' || LPAD(i::text, 12, '0'))::uuid,
          'invoice',
          'INV-BENCH-' || i,
          'draft',
          'paid',
          'delivered',
          ('00000000-0000-0000-0003-' || LPAD(((i % 20) + 1)::text, 12, '0'))::uuid,
          '00000000-0000-0000-0000-000000000003'::uuid,
          '00000000-0000-0000-0000-000000000002'::uuid,
          150000,
          26250,
          176250,
          0,
          (NOW() - (INTERVAL '1 day' * (i % 30)))::date,
          (NOW() - (INTERVAL '1 day' * (i % 30)) + INTERVAL '30 days')::date,
          'office'
        FROM generate_series(1, ${neededSd}) i;
      `);

      // Then insert lines
      await client.query(`
        INSERT INTO sales_document_lines (
          id, document_id, product_id, sku, quantity, unit_price_minor, unit_cost_minor,
          tax_rate_id, tax_rate_basis_points, line_total_minor, tax_minor
        )
        SELECT
          gen_random_uuid(),
          ('00000000-0000-0000-0004-' || LPAD(i::text, 12, '0'))::uuid,
          ('00000000-0000-0000-0002-' || LPAD(((i % 50) + 1)::text, 12, '0'))::uuid,
          'SKU-' || ((i % 50) + 1),
          1,
          150000,
          100000,
          '00000000-0000-0000-0000-000000000020'::uuid,
          1750,
          176250,
          26250
        FROM generate_series(1, ${neededSd}) i;
      `);

      // Update to issued
      await client.query(`
        UPDATE sales_documents
        SET status = 'issued'
        WHERE document_number LIKE 'INV-BENCH-%';
      `);
      console.log('20,000 invoices and lines generated.');
    }

    // Refresh statistics
    console.log('Running ANALYZE to update PostgreSQL optimizer statistics...');
    await client.query('ANALYZE stock_movements; ANALYZE sales_documents; ANALYZE sales_document_lines; ANALYZE delivery_notes; ANALYZE delivery_note_lines;');

    // Ensure supporting indexes
    console.log('Ensuring reporting indexes exist...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS stock_movements_occurred_at_idx ON stock_movements (occurred_at);
      CREATE INDEX IF NOT EXISTS sales_docs_report_perf_idx ON sales_documents (document_type, status, issue_date);
    `);
    await client.query('ANALYZE stock_movements; ANALYZE sales_documents;');

    // 3. EXPLAIN ANALYZE on the three core queries
    const fromDate = '2026-10-01';
    const toDate = '2026-11-04';

    console.log('\n===============================================================');
    console.log('1. EXPLAIN (ANALYZE, BUFFERS) - Sales by Item (20,000 Invoices)');
    console.log('===============================================================');
    const salesPlan = await client.query(`
      EXPLAIN (ANALYZE, BUFFERS, COSTS)
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
          AND sd.issue_date >= $1::date
          AND sd.issue_date <= $2::date
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
      ORDER BY i.revenue DESC;
    `, [fromDate, toDate]);
    salesPlan.rows.forEach(r => console.log(Object.values(r)[0]));

    console.log('\n===============================================================');
    console.log('2. EXPLAIN (ANALYZE, BUFFERS) - Stock Valuation As-Of (50,000 Movements)');
    console.log('===============================================================');
    const stockPlan = await client.query(`
      EXPLAIN (ANALYZE, BUFFERS, COSTS)
      WITH ledger_replay AS (
        SELECT
          sm.product_id,
          sm.location_id,
          SUM(sm.quantity) AS on_hand_replayed,
          ROUND(SUM(sm.total_cost_minor))::bigint AS valuation_replayed
        FROM stock_movements sm
        WHERE sm.occurred_at <= $1::timestamptz
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
      ORDER BY loc.name, p.name;
    `, [new Date().toISOString()]);
    stockPlan.rows.forEach(r => console.log(Object.values(r)[0]));

    console.log('\n===============================================================');
    console.log('3. EXPLAIN (ANALYZE, BUFFERS) - VAT Summary (20,000 Invoices)');
    console.log('===============================================================');
    const vatPlan = await client.query(`
      EXPLAIN (ANALYZE, BUFFERS, COSTS)
      SELECT
        sdl.tax_rate_id,
        COALESCE(tr.name, CONCAT((sdl.tax_rate_basis_points::numeric / 100)::text, '%')) AS rate_name,
        (sdl.tax_rate_basis_points::numeric / 100)::text AS rate_percent,
        SUM(CASE WHEN sd.document_type = 'invoice' THEN (sdl.line_total_minor - sdl.tax_minor) ELSE 0 END)::text AS taxable_sales_minor,
        SUM(CASE WHEN sd.document_type = 'invoice' THEN sdl.tax_minor ELSE 0 END)::text AS output_vat_minor,
        SUM(CASE WHEN sd.document_type = 'credit_note' THEN (sdl.line_total_minor - sdl.tax_minor) ELSE 0 END)::text AS taxable_credit_minor,
        SUM(CASE WHEN sd.document_type = 'credit_note' THEN sdl.tax_minor ELSE 0 END)::text AS credit_vat_minor
      FROM sales_documents sd
      JOIN sales_document_lines sdl ON sdl.document_id = sd.id
      LEFT JOIN tax_rates tr ON tr.id = sdl.tax_rate_id
      WHERE sd.issue_date >= $1::date
        AND sd.issue_date <= $2::date
        AND sd.status != 'void'
        AND sd.document_type IN ('invoice', 'credit_note')
      GROUP BY sdl.tax_rate_id, tr.name, sdl.tax_rate_basis_points
      ORDER BY rate_percent DESC;
    `, [fromDate, toDate]);
    vatPlan.rows.forEach(r => console.log(Object.values(r)[0]));

    console.log('\n===============================================================');
    console.log('4. EXPLAIN (ANALYZE, BUFFERS) - Profit by Item (20,000 Invoices & Delivery Notes)');
    console.log('===============================================================');
    const profitPlan = await client.query(`
      EXPLAIN (ANALYZE, BUFFERS, COSTS)
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
        AND dn.delivery_date >= $1::date
        AND dn.delivery_date <= $2::date
      GROUP BY p.id, p.name, p.sku, cat.name
      ORDER BY revenue_minor DESC;
    `, [fromDate, toDate]);
    profitPlan.rows.forEach(r => console.log(Object.values(r)[0]));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
