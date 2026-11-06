import 'dotenv/config';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function check() {
  const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST;
  const pool = new Pool({ connectionString: testDbUrl });
  try {
    const tables = await pool.query(`
      SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'ace_app_user'
      ORDER BY table_name, privilege_type;
    `);
    const journalPrivs = tables.rows.filter(r => r.table_name.startsWith('journal'));
    console.log('journal privileges for ace_app_user:', journalPrivs);
  } finally {
    await pool.end();
  }
}

check().catch(console.error);
