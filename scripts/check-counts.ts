import 'dotenv/config';
import { db } from '../src/server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const sm = await db.execute(sql`SELECT count(*)::text as c FROM stock_movements`);
  const sd = await db.execute(sql`SELECT count(*)::text as c FROM sales_documents`);
  console.log('stock_movements count:', sm.rows[0]?.c, 'sales_documents count:', sd.rows[0]?.c);
  process.exit(0);
}
main().catch(console.error);

