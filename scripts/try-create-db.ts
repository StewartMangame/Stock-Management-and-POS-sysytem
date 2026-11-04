import 'dotenv/config';
import { db } from '../src/server/db';
import { sql } from 'drizzle-orm';

async function main() {
  try {
    await db.execute(sql`CREATE DATABASE testdb;`);
    console.log('Successfully created testdb!');
  } catch (err: any) {
    console.log('Create db result/error:', err.message);
  }
  process.exit(0);
}
main().catch(console.error);

