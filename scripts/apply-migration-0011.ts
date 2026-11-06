import 'dotenv/config';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import * as fs from 'fs';

neonConfig.webSocketConstructor = ws;

async function main() {
  const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST;
  if (!testDbUrl) throw new Error('TEST_DATABASE_URL not set');

  const pool = new Pool({ connectionString: testDbUrl });
  try {
    const sqlContent = fs.readFileSync('src/server/db/migrations/0011_milestone7_accounting.sql', 'utf-8');
    await pool.query(sqlContent);
    await pool.query("INSERT INTO _migrations (filename) VALUES ('0011_milestone7_accounting.sql') ON CONFLICT DO NOTHING");
    console.log('Migration 0011 applied successfully to testdb.');
  } finally {
    await pool.end();
  }
}

main().catch(console.error);

