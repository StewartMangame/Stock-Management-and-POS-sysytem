/**
 * READ-ONLY: Inspect goods receipt 9e935654-972b-4f31-8b87-22cefe36db35 and associated PO.
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

    const { rows: gr } = await client.query(`
      SELECT *
      FROM goods_receipts
      WHERE id = '9e935654-972b-4f31-8b87-22cefe36db35'
    `);
    console.log('\n=== Goods Receipt (all columns) ===');
    console.table(gr);
    console.log('\n=== Goods Receipt ===');
    console.table(gr);

    const { rows: lines } = await client.query(`
      SELECT gri.id, gri.goods_receipt_id, gri.product_id, p.sku, p.name,
             gri.received_qty, gri.unit_cost_supplier, gri.unit_cost_mwk_minor,
             gri.landed_cost_share_minor, gri.landed_unit_cost_minor, gri.line_total_mwk_minor
      FROM goods_receipt_items gri
      JOIN products p ON p.id = gri.product_id
      WHERE gri.goods_receipt_id = '9e935654-972b-4f31-8b87-22cefe36db35'
    `);
    console.log('\n=== Goods Receipt Items ===');
    console.table(lines);

    const { rows: po } = await client.query(`
      SELECT po.*
      FROM purchase_orders po
      WHERE po.id IN (
        SELECT purchase_order_id FROM goods_receipts WHERE id = '9e935654-972b-4f31-8b87-22cefe36db35'
      )
    `);
    console.log('\n=== Purchase Order ===');
    console.table(po);

    if (po.length > 0) {
      const { rows: poItems } = await client.query(`
        SELECT poi.*
        FROM purchase_order_items poi
        WHERE poi.purchase_order_id = $1
      `, [po[0].id]);
      console.log('\n=== Purchase Order Items ===');
      console.table(poItems);
    }

    await client.query('COMMIT;');
  } finally {
    client.release();
  }
}

main().catch(console.error).finally(() => pool.end());
