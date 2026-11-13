import * as dotenv from 'dotenv';
dotenv.config();
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    await client.query('BEGIN; SET LOCAL TRANSACTION READ ONLY;');

    console.log('=== RECONCILING VAT: ALL TIME ===');

    // 1. All-time breakdown by Month, Document Type, and Rate
    const { rows: allRows } = await client.query(`
      SELECT
        to_char(sd.issue_date, 'YYYY-MM') AS month,
        sd.document_type,
        COALESCE(tr.name, 'No Tax Rate') AS rate_name,
        COALESCE(tr.rate_basis_points, sdl.tax_rate_basis_points) AS rate_bps,
        COUNT(DISTINCT sd.id) AS doc_count,
        COUNT(sdl.id) AS line_count,
        SUM(sdl.line_total_minor - sdl.tax_minor) AS net_minor,
        SUM(sdl.tax_minor) AS tax_minor,
        SUM(sdl.line_total_minor) AS gross_minor
      FROM sales_document_lines sdl
      JOIN sales_documents sd ON sd.id = sdl.document_id
      LEFT JOIN tax_rates tr ON tr.id = sdl.tax_rate_id
      WHERE sd.document_type IN ('invoice', 'credit_note')
        AND sd.status != 'void'
      GROUP BY to_char(sd.issue_date, 'YYYY-MM'), sd.document_type, tr.name, COALESCE(tr.rate_basis_points, sdl.tax_rate_basis_points)
      ORDER BY month, sd.document_type, rate_bps DESC;
    `);

    console.log('\n--- All Months & Documents (Including Test Rates) ---');
    console.table(allRows.map(r => ({
      Month: r.month,
      DocType: r.document_type,
      Rate: `${r.rate_name} (${(Number(r.rate_bps)/100).toFixed(1)}%)`,
      Docs: r.doc_count,
      Lines: r.line_count,
      'Net (MWK)': (Number(r.net_minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }),
      'Tax (MWK)': (Number(r.tax_minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }),
      'Gross (MWK)': (Number(r.gross_minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }),
    })));

    // 2. Totals WITH test rates
    const { rows: totalsWithTest } = await client.query(`
      SELECT
        SUM(CASE WHEN sd.document_type = 'invoice' THEN (sdl.line_total_minor - sdl.tax_minor)
                 WHEN sd.document_type = 'credit_note' THEN -(sdl.line_total_minor - sdl.tax_minor) END) AS net_minor,
        SUM(CASE WHEN sd.document_type = 'invoice' THEN sdl.tax_minor
                 WHEN sd.document_type = 'credit_note' THEN -sdl.tax_minor END) AS tax_minor,
        SUM(CASE WHEN sd.document_type = 'invoice' THEN sdl.line_total_minor
                 WHEN sd.document_type = 'credit_note' THEN -sdl.line_total_minor END) AS gross_minor
      FROM sales_document_lines sdl
      JOIN sales_documents sd ON sd.id = sdl.document_id
      WHERE sd.document_type IN ('invoice', 'credit_note')
        AND sd.status != 'void';
    `);

    console.log('\n--- VAT Report Grand Totals (WITH test-created rates) ---');
    console.table([{
      'Net Taxable (MWK)': (Number(totalsWithTest[0].net_minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }),
      'Net Tax (MWK)': (Number(totalsWithTest[0].tax_minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }),
      'Gross Total (MWK)': (Number(totalsWithTest[0].gross_minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }),
    }]);

    // 3. Totals WITHOUT test rates (Pure genuine default VAT 17.5%)
    const { rows: totalsPure } = await client.query(`
      SELECT
        SUM(CASE WHEN sd.document_type = 'invoice' THEN (sdl.line_total_minor - sdl.tax_minor)
                 WHEN sd.document_type = 'credit_note' THEN -(sdl.line_total_minor - sdl.tax_minor) END) AS net_minor,
        SUM(CASE WHEN sd.document_type = 'invoice' THEN sdl.tax_minor
                 WHEN sd.document_type = 'credit_note' THEN -sdl.tax_minor END) AS tax_minor,
        SUM(CASE WHEN sd.document_type = 'invoice' THEN sdl.line_total_minor
                 WHEN sd.document_type = 'credit_note' THEN -sdl.line_total_minor END) AS gross_minor
      FROM sales_document_lines sdl
      JOIN sales_documents sd ON sd.id = sdl.document_id
      LEFT JOIN tax_rates tr ON tr.id = sdl.tax_rate_id
      WHERE sd.document_type IN ('invoice', 'credit_note')
        AND sd.status != 'void'
        AND (tr.name IS NULL OR (
          tr.name NOT LIKE 'P5 Standard 16.5%%'
          AND tr.name NOT LIKE 'P3 Zero%%'
          AND tr.name NOT LIKE 'P4 Zero%%'
          AND tr.name NOT LIKE 'FP Standard%%'
        ));
    `);

    console.log('\n--- VAT Report Grand Totals (WITHOUT test-created rates: Genuine Default VAT only) ---');
    console.table([{
      'Net Taxable (MWK)': (Number(totalsPure[0].net_minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }),
      'Net Tax (MWK)': (Number(totalsPure[0].tax_minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }),
      'Gross Total (MWK)': (Number(totalsPure[0].gross_minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }),
    }]);

    await client.query('COMMIT;');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);

