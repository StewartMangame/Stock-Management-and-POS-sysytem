/**
 * READ-ONLY: Investigate LAP-DEL-5440 and direct edits to stock_movements / products.
 * Checks audit_log for any direct edits to avg_cost_minor or stock_movements.
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

    // 1. Find the product
    const { rows: prod } = await client.query(`
      SELECT id, sku, name, avg_cost_minor, selling_price_minor, is_active, updated_at
      FROM products
      WHERE sku = 'LAP-DEL-5440'
      LIMIT 1
    `);
    console.log('\n=== Product LAP-DEL-5440 ===');
    console.table(prod);

    if (prod.length === 0) {
      console.log('Product not found in neondb');
      await client.query('COMMIT;');
      return;
    }
    const productId = prod[0].id;

    // 2. All stock movements for this product
    const { rows: movements } = await client.query(`
      SELECT id, movement_type, reference_type, reference_id,
             quantity, unit_cost_minor, occurred_at, created_at, created_by
      FROM stock_movements
      WHERE product_id = $1
      ORDER BY occurred_at, created_at
    `, [productId]);
    console.log(`\n=== Stock Movements for ${prod[0].sku} (${movements.length} rows) ===`);
    console.table(movements);

    // 3. Audit log entries for this product
    const { rows: auditProd } = await client.query(`
      SELECT id, action, user_id, entity_type, entity_id,
             before, after, at
      FROM audit_log
      WHERE entity_type = 'product' AND entity_id = $1
      ORDER BY at
    `, [productId]);
    console.log(`\n=== Audit Log — product ${productId} ===`);
    console.table(auditProd);

    // 4. Audit log entries for stock_movements of this product
    const { rows: auditMvt } = await client.query(`
      SELECT al.id, al.action, al.user_id, al.entity_type, al.entity_id,
             al.before, al.after, al.at
      FROM audit_log al
      WHERE al.entity_type = 'stock_movement'
        AND al.entity_id IN (
          SELECT id FROM stock_movements WHERE product_id = $1
        )
      ORDER BY al.at
    `, [productId]);
    console.log(`\n=== Audit Log — stock_movements for product ===`);
    console.table(auditMvt);

    // 5. Any direct UPDATE audit on products table for avg_cost
    const { rows: directEdits } = await client.query(`
      SELECT id, action, user_id, entity_type, entity_id,
             before, after, at
      FROM audit_log
      WHERE entity_type = 'product'
        AND (after::text ILIKE '%avg_cost%' OR action ILIKE '%avg_cost%')
      ORDER BY at DESC
      LIMIT 20
    `);
    console.log('\n=== Direct avg_cost edits in audit_log ===');
    console.table(directEdits);

    // 6. Top 5 highest unit_cost_minor movements (find the bad one)
    const { rows: topCost } = await client.query(`
      SELECT sm.id, p.sku, sm.movement_type, sm.unit_cost_minor,
             sm.quantity, sm.occurred_at, sm.reference_type, sm.reference_id
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      ORDER BY sm.unit_cost_minor DESC
      LIMIT 10
    `);
    console.log('\n=== Top 10 unit_cost_minor movements (looking for the 4.4B outlier) ===');
    console.table(topCost);

    // 7. Stock valuation - all products
    const { rows: valuation } = await client.query(`
      SELECT p.sku, p.name, p.avg_cost_minor,
             SUM(sm.quantity) AS total_qty,
             SUM(sm.quantity * sm.unit_cost_minor) AS total_value_minor
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      WHERE sm.movement_type IN ('opening','purchase_receipt','customer_return')
        AND sm.quantity > 0
      GROUP BY p.sku, p.name, p.avg_cost_minor
      HAVING SUM(sm.quantity * sm.unit_cost_minor) > 0
      ORDER BY total_value_minor DESC
      LIMIT 10
    `);
    console.log('\n=== Top 10 products by stock value ===');
    console.table(valuation);

    await client.query('COMMIT;');
  } finally {
    client.release();
  }
}

main().catch(console.error).finally(() => pool.end());

