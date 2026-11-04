import 'dotenv/config';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function main() {
  const testDbUrl = process.env.DATABASE_URL_TEST || process.env.TEST_DATABASE_URL;
  const pool = new Pool({ connectionString: testDbUrl });
  const client = await pool.connect();
  try {
    const sm = await client.query('SELECT count(*)::text as c FROM stock_movements');
    const sd = await client.query('SELECT count(*)::text as c FROM sales_documents');
    const sdl = await client.query('SELECT count(*)::text as c FROM sales_document_lines');
    console.log('stock_movements:', sm.rows[0].c, 'sales_documents:', sd.rows[0].c, 'sales_document_lines:', sdl.rows[0].c);

    if (parseInt(sdl.rows[0].c) < 20000) {
      console.log('Inserting missing sales_document_lines...');
      await client.query(`
        INSERT INTO sales_document_lines (
          id, document_id, product_id, sku, quantity, unit_price_minor, unit_cost_minor,
          tax_rate_id, tax_rate_basis_points, line_total_minor, tax_minor
        )
        SELECT
          gen_random_uuid(),
          sd.id,
          ('00000000-0000-0000-0002-' || LPAD(((ROW_NUMBER() OVER () % 50) + 1)::text, 12, '0'))::uuid,
          'SKU-' || ((ROW_NUMBER() OVER () % 50) + 1),
          1,
          150000,
          100000,
          '00000000-0000-0000-0000-000000000020'::uuid,
          1750,
          176250,
          26250
        FROM sales_documents sd
        WHERE sd.document_number LIKE 'INV-BENCH-%'
        ON CONFLICT DO NOTHING;
      `);
      console.log('Done inserting sales_document_lines.');
      const sdlAfter = await client.query('SELECT count(*)::text as c FROM sales_document_lines');
      console.log('sales_document_lines after insert:', sdlAfter.rows[0].c);
    }
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(console.error);

