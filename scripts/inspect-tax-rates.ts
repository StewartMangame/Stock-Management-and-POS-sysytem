/**
 * READ-ONLY: Show tax_rates table and invoice/credit-note breakdown by rate and month.
 * Uses an explicit READ ONLY transaction against neondb.
 */
import 'dotenv/config';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');

const pool = new Pool({ connectionString: url });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN; SET LOCAL TRANSACTION READ ONLY;');

    // 1. Full tax_rates table
    const { rows: rates } = await client.query(`
      SELECT id, name, rate_basis_points, is_default, created_at, updated_at
      FROM tax_rates
      ORDER BY rate_basis_points DESC, created_at
    `);
    console.log('\n=== tax_rates ===');
    console.table(rates);

    // 2. Document lines breakdown: type, rate, month, counts, net, tax
    const { rows: breakdown } = await client.query(`
      SELECT
        sd.document_type,
        tr.name            AS rate_name,
        tr.rate_basis_points,
        to_char(sd.issue_date, 'YYYY-MM') AS month,
        COUNT(*)           AS line_count,
        COUNT(DISTINCT sd.id) AS doc_count,
        SUM(sdl.line_total_minor - sdl.tax_minor) AS total_net_minor,
        SUM(sdl.tax_minor) AS total_tax_minor
      FROM sales_document_lines sdl
      JOIN sales_documents sd  ON sd.id = sdl.document_id
      LEFT JOIN tax_rates tr   ON tr.id = sdl.tax_rate_id
      WHERE sd.document_type IN ('invoice','credit_note')
        AND sd.status NOT IN ('void')
      GROUP BY sd.document_type, tr.name, tr.rate_basis_points, to_char(sd.issue_date, 'YYYY-MM')
      ORDER BY month DESC, sd.document_type, tr.rate_basis_points DESC
    `);
    console.log('\n=== Invoice & Credit Note Lines by Tax Rate and Month ===');
    console.table(breakdown);

    // 3. Summary totals by rate only
    const { rows: summary } = await client.query(`
      SELECT
        tr.name            AS rate_name,
        tr.rate_basis_points,
        tr.is_default,
        COUNT(*)           AS line_count,
        COUNT(DISTINCT sd.id) AS doc_count,
        SUM(sdl.line_total_minor - sdl.tax_minor) AS total_net_minor,
        SUM(sdl.tax_minor) AS total_tax_minor
      FROM sales_document_lines sdl
      JOIN sales_documents sd  ON sd.id = sdl.document_id
      LEFT JOIN tax_rates tr   ON tr.id = sdl.tax_rate_id
      WHERE sd.document_type IN ('invoice','credit_note')
        AND sd.status NOT IN ('void')
      GROUP BY tr.name, tr.rate_basis_points, tr.is_default
      ORDER BY tr.rate_basis_points DESC
    `);
    console.log('\n=== Summary by Tax Rate (all time) ===');
    console.table(summary);

    await client.query('COMMIT;');
  } finally {
    client.release();
  }
}

main().catch(console.error).finally(() => pool.end());

