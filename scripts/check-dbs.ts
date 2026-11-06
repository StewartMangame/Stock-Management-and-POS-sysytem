import 'dotenv/config';
import { db } from '../src/server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const dbs = await db.execute(sql`SELECT datname FROM pg_database WHERE datistemplate = false;`);
  console.log('Databases:', dbs.rows.map(r => r.datname));
  process.exit(0);
}
main().catch(console.error);

