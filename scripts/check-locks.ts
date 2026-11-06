import 'dotenv/config';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function main() {
  const testDbUrl = process.env.DATABASE_URL_TEST || process.env.TEST_DATABASE_URL;
  const pool = new Pool({ connectionString: testDbUrl });
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT pid, usename, state, query_start, state_change, query
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid();
    `);
    console.log('Active queries in testdb:', res.rows);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(console.error);

