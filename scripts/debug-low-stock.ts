import 'dotenv/config';
import { db } from '../src/server/db';
import { sql } from 'drizzle-orm';
import { getManagerDashboardData } from '../src/server/services/dashboard';
import { getLowStockReport } from '../src/server/services/reports/stock-report';

async function main() {
  const dash = await getManagerDashboardData();
  const rep = await getLowStockReport();
  console.log('dash lowStockCount:', dash.lowStockCount);
  console.log('rep rows length:', rep.rows.length);

  const dashRows = await db.execute(sql`
    SELECT sb.product_id, sb.location_id
    FROM stock_balances sb
    JOIN products p ON p.id = sb.product_id
    WHERE p.is_active = TRUE
      AND p.min_stock_alert IS NOT NULL
      AND sb.on_hand <= p.min_stock_alert
  `);

  const repRows = await db.execute(sql`
    SELECT sb.product_id, sb.location_id
    FROM stock_balances sb
    JOIN products p ON p.id = sb.product_id AND p.is_active = TRUE AND p.min_stock_alert IS NOT NULL
    JOIN locations loc ON loc.id = sb.location_id
    WHERE sb.on_hand <= p.min_stock_alert
  `);

  console.log('dashRows count:', dashRows.rows.length, 'repRows count:', repRows.rows.length);
  // Find which row is in dashRows but not in repRows
  const repKeys = new Set(repRows.rows.map((r: any) => `${r.product_id}-${r.location_id}`));
  for (const r of dashRows.rows as any[]) {
    if (!repKeys.has(`${r.product_id}-${r.location_id}`)) {
      console.log('Difference row in dash but not rep:', r);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

