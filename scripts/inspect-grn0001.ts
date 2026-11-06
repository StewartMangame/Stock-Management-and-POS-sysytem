import 'dotenv/config';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function check() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // 1. MAIN-GRN-0001 details
    const grn = await pool.query(`
      SELECT gr.id, gr.grn_number, gr.status, gr.currency, gr.exchange_rate,
             gr.total_items_mwk_minor, gr.total_landed_mwk_minor, gr.created_at,
             gri.product_id, gri.received_qty, gri.unit_cost_supplier, gri.unit_cost_mwk_minor,
             p.sku, p.name, p.avg_cost_minor, p.last_cost_minor, p.selling_price_minor
      FROM goods_receipts gr
      JOIN goods_receipt_items gri ON gri.goods_receipt_id = gr.id
      JOIN products p ON p.id = gri.product_id
      WHERE gr.grn_number = 'MAIN-GRN-0001'
    `);
    console.log('MAIN-GRN-0001:', grn.rows);

    // 2. Total stock valuation across all products
    const val = await pool.query(`
      SELECT 
        SUM(sb.on_hand * p.avg_cost_minor) AS total_valuation_tambala,
        COUNT(DISTINCT p.id) AS product_count,
        SUM(sb.on_hand) AS total_units
      FROM stock_balances sb
      JOIN products p ON p.id = sb.product_id
    `);
    console.log('Stock Valuation:', val.rows[0]);

    // 3. LAP-DEL-5440 balance and stock movements
    const lap = await pool.query(`
      SELECT p.sku, p.name, p.avg_cost_minor, sb.on_hand, sb.reserved
      FROM products p
      LEFT JOIN stock_balances sb ON sb.product_id = p.id
      WHERE p.sku = 'LAP-DEL-5440'
    `);
    console.log('LAP-DEL-5440 status:', lap.rows);
  } finally {
    await pool.end();
  }
}

check().catch(console.error);

