import 'dotenv/config';
import { db } from '../src/server/db';
import { sql } from 'drizzle-orm';
import { todayInCompanyTz } from '../src/lib/timezone';
import { getManagerDashboardData } from '../src/server/services/dashboard';
import { getSalesByDay } from '../src/server/services/reports/sales-report';

async function main() {
  const today = todayInCompanyTz();
  const dash = await getManagerDashboardData();
  const rep = await getSalesByDay({ from: today, to: today, groupBy: 'day' });
  console.log('today:', today);
  console.log('dash salesToday:', dash.salesToday);
  console.log('rep totals:', rep.totals);
  console.log('rep rows:', rep.rows);

  const docs = await db.execute(sql`
    SELECT id, document_number, document_type, channel, status, issue_date, subtotal_minor, tax_minor, total_minor
    FROM sales_documents
    WHERE issue_date = ${today}::date
  `);
  console.log('docs today count:', docs.rows.length);
  for (const d of docs.rows) {
    console.log(d);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

