import 'dotenv/config';
import { db } from '../src/server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('--- 1. Updating LAP-DEL-5440 avg_cost_minor to 145000000 (MWK 1,450,000.00) ---');
  await db.execute(sql`
    UPDATE products
    SET avg_cost_minor = 145000000
    WHERE sku = 'LAP-DEL-5440';
  `);

  console.log('--- 2. Top 10 Stock Products with Quantity x Average Cost ---');
  const topStock = await db.execute(sql`
    SELECT
      p.sku,
      p.name,
      p.product_type,
      SUM(sb.on_hand) as quantity_on_hand,
      p.avg_cost_minor as avg_cost_tambala,
      (p.avg_cost_minor / 100)::numeric(18,2) as avg_cost_mwk,
      (SUM(sb.on_hand * p.avg_cost_minor)) as total_cost_tambala,
      (SUM(sb.on_hand * p.avg_cost_minor) / 100)::numeric(18,2) as total_val_mwk
    FROM products p
    JOIN stock_balances sb ON sb.product_id = p.id
    WHERE p.is_active = TRUE AND sb.on_hand > 0
    GROUP BY p.id, p.sku, p.name, p.product_type, p.avg_cost_minor
    ORDER BY (SUM(sb.on_hand * p.avg_cost_minor)) DESC
    LIMIT 10;
  `);
  console.table(topStock.rows);

  const totalVal = await db.execute(sql`
    SELECT
      SUM(sb.on_hand * p.avg_cost_minor) as total_tambala,
      (SUM(sb.on_hand * p.avg_cost_minor) / 100)::numeric(18,2) as total_mwk
    FROM products p
    JOIN stock_balances sb ON sb.product_id = p.id
    WHERE p.is_active = TRUE;
  `);
  console.log('Total Stock Valuation across database:');
  console.table(totalVal.rows);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

