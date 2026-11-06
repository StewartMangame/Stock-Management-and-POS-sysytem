import 'dotenv/config';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function main() {
  const testDbUrl = process.env.DATABASE_URL_TEST || process.env.TEST_DATABASE_URL;
  if (!testDbUrl) throw new Error('No test db url');

  const pool = new Pool({ connectionString: testDbUrl });
  const client = await pool.connect();
  try {
    console.log('Cleaning testdb for integration test suite...');
    await client.query(`
      TRUNCATE TABLE 
        delivery_note_lines,
        delivery_notes,
        sales_document_lines,
        sales_documents,
        stock_movements,
        stock_balances,
        serial_numbers,
        goods_receipt_items,
        goods_receipts,
        purchase_order_items,
        purchase_orders,
        stock_counts,
        stock_adjustments,
        stock_reservations,
        quotation_lines,
        quotations,
        payments,
        payment_allocations,
        pos_shifts,
        cash_movements,
        held_sales,
        statement_lines,
        statement_imports,
        reconciliation_matches
      CASCADE;
    `);
    console.log('Cleaned testdb successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(console.error);

