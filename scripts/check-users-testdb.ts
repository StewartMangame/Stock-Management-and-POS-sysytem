/**
 * Check users in testdb — confirm role assignments.
 */
import 'dotenv/config';
import { Pool } from '@neondatabase/serverless';

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL_TEST;
if (!url) throw new Error('TEST_DATABASE_URL not set');

const pool = new Pool({ connectionString: url });

async function main() {
  const { rows } = await pool.query(`
    SELECT u.id, u.name, u.email, u.is_active, r.name as role_name, r.id as role_id,
           array_length(r.permissions, 1) as perm_count
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    ORDER BY u.created_at
    LIMIT 20
  `);
  console.log('=== Users in testdb ===');
  for (const r of rows) {
    console.log(`  [${r.role_name ?? 'NO ROLE'}] ${r.email} active=${r.is_active} perms=${r.perm_count ?? 0}`);
  }
}

main().catch(console.error).finally(() => pool.end());

