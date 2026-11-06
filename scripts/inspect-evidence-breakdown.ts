import 'dotenv/config';
import { db } from '../src/server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('================================================================');
  console.log('1. DETAILED VAT BY RATE BREAKDOWN ACROSS SALES DOCUMENTS');
  console.log('================================================================');
  const vatBreakdown = await db.execute(sql`
    SELECT
      COALESCE(tr.name, 'No rate / basis ' || sdl.tax_rate_basis_points::text) AS rate_name,
      sdl.tax_rate_basis_points,
      (sdl.tax_rate_basis_points::numeric / 100)::text AS rate_pct,
      sd.document_type,
      COUNT(*)::text AS line_count,
      SUM(sdl.line_total_minor - sdl.tax_minor)::text AS net_minor,
      SUM(sdl.tax_minor)::text AS tax_minor,
      (SUM(sdl.line_total_minor - sdl.tax_minor) / 100)::numeric(18,2) AS net_mwk,
      (SUM(sdl.tax_minor) / 100)::numeric(18,2) AS tax_mwk
    FROM sales_documents sd
    JOIN sales_document_lines sdl ON sdl.document_id = sd.id
    LEFT JOIN tax_rates tr ON tr.id = sdl.tax_rate_id
    WHERE sd.status != 'void'
    GROUP BY tr.name, sdl.tax_rate_basis_points, sd.document_type
    ORDER BY sdl.tax_rate_basis_points DESC, sd.document_type;
  `);

  console.table(vatBreakdown.rows);

  console.log('\n================================================================');
  console.log('2. TOP 10 STOCK PRODUCTS BY VALUATION IN CURRENT DB');
  console.log('================================================================');
  const topStock = await db.execute(sql`
    SELECT
      p.name,
      p.sku,
      p.product_type,
      p.avg_cost_minor,
      (p.avg_cost_minor / 100)::numeric(18,2) AS avg_cost_mwk,
      SUM(sb.on_hand) AS total_on_hand,
      SUM(sb.on_hand * p.avg_cost_minor) AS total_val_tambala,
      (SUM(sb.on_hand * p.avg_cost_minor) / 100)::numeric(18,2) AS total_val_mwk
    FROM products p
    JOIN stock_balances sb ON sb.product_id = p.id
    WHERE p.is_active = TRUE AND sb.on_hand > 0
    GROUP BY p.id, p.name, p.sku, p.product_type, p.avg_cost_minor
    ORDER BY total_val_tambala DESC
    LIMIT 10;
  `);

  console.table(topStock.rows);

  console.log('\n================================================================');
  console.log('3. SUMMARY OF CURRENT DATABASE TABLES & SEED DATA ORIGIN');
  console.log('================================================================');
  const counts = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM products) AS total_products,
      (SELECT COUNT(*) FROM customers) AS total_customers,
      (SELECT COUNT(*) FROM sales_documents) AS total_sales_docs,
      (SELECT COUNT(*) FROM stock_movements) AS total_stock_movements,
      (SELECT COUNT(*) FROM delivery_notes) AS total_delivery_notes,
      (SELECT COUNT(*) FROM payments) AS total_payments;
  `);
  console.table(counts.rows);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

