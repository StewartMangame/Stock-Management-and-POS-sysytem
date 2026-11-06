/**
 * Diagnostic: show all roles in testdb and their permissions arrays.
 */
import 'dotenv/config';
import { Pool } from '@neondatabase/serverless';

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL_TEST;
if (!url) throw new Error('TEST_DATABASE_URL not set');

const pool = new Pool({ connectionString: url });

async function main() {
  const { rows } = await pool.query(`SELECT id, name, permissions FROM roles ORDER BY name`);
  console.log('=== Roles in testdb ===');
  for (const r of rows) {
    console.log(`\n[${r.name}] id=${r.id}`);
    console.log('  permissions:', JSON.stringify(r.permissions, null, 2));
  }
}

main().catch(console.error).finally(() => pool.end());
