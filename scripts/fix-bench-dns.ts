import 'dotenv/config';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function main() {
  const testDbUrl = process.env.DATABASE_URL_TEST || process.env.TEST_DATABASE_URL;
  const pool = new Pool({ connectionString: testDbUrl });
  const client = await pool.connect();
  try {
    const dnCount = await client.query('SELECT count(*)::text as c FROM delivery_notes');
    console.log('Current delivery notes:', dnCount.rows[0].c);

    if (parseInt(dnCount.rows[0].c) < 20000) {
      console.log('Inserting 20,000 delivery notes...');
      await client.query(`
        INSERT INTO delivery_notes (
          id, delivery_number, sales_document_id, location_id, customer_id, delivery_date, status
        )
        SELECT
          ('00000000-0000-0000-0005-' || LPAD(ROW_NUMBER() OVER ()::text, 12, '0'))::uuid,
          'DN-BENCH-' || ROW_NUMBER() OVER (),
          sd.id,
          sd.location_id,
          sd.customer_id,
          sd.issue_date,
          'dispatched'
        FROM sales_documents sd
        WHERE sd.document_number LIKE 'INV-BENCH-%'
        ON CONFLICT (id) DO NOTHING;
      `);
      console.log('Delivery notes inserted.');

      console.log('Inserting 20,000 delivery note lines...');
      await client.query(`
        INSERT INTO delivery_note_lines (
          id, delivery_note_id, sales_document_line_id, product_id, quantity, unit_cost_minor, total_cost_minor
        )
        SELECT
          gen_random_uuid(),
          dn.id,
          sdl.id,
          sdl.product_id,
          sdl.quantity,
          sdl.unit_cost_minor,
          sdl.quantity * sdl.unit_cost_minor
        FROM delivery_notes dn
        JOIN sales_documents sd ON sd.id = dn.sales_document_id
        JOIN sales_document_lines sdl ON sdl.document_id = sd.id
        WHERE dn.delivery_number LIKE 'DN-BENCH-%'
        ON CONFLICT (id) DO NOTHING;
      `);
      console.log('Delivery note lines inserted.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(console.error);

