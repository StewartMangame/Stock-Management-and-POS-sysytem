import * as dotenv from 'dotenv';
dotenv.config();
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function main() {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST;
  if (!url) {
    console.error('No test database url');
    return;
  }
  const pool = new Pool({ connectionString: url });
  try {
    const r = await pool.query(`DELETE FROM users WHERE name LIKE 'Lockout Manager%'`);
    console.log('Cleaned stale lockout managers:', r.rowCount);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
