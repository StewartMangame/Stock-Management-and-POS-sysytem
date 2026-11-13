/**
 * Pretest migration script.
 *
 * Run automatically before the test suite via `package.json` pretest hook.
 * Applies all pending SQL migrations to the TEST database using the owner
 * connection string (MIGRATION_DATABASE_URL from .env.test or .env).
 *
 * Does NOT require typing the database name — this is non-interactive CI usage.
 * Does NOT run on remote databases that are flagged as protected.
 *
 * Usage: called by `npm run pretest` (see package.json).
 */
import { config } from 'dotenv';
import { Pool } from 'pg';
import { runMigrationsNode } from './migrate-node';

// Load test env first so MIGRATION_DATABASE_URL can point at the Docker DB
config({ path: '.env.test', override: false });
config({ path: '.env', override: false });

async function main() {
  const url =
    process.env.MIGRATION_DATABASE_URL ||
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL_TEST;

  if (!url) {
    console.warn(
      '[pretest] No MIGRATION_DATABASE_URL / TEST_DATABASE_URL set — skipping auto-migration.',
    );
    process.exit(0);
  }

  console.log('[pretest] Auto-migrating test database...');
  const pool = new Pool({ connectionString: url });

  try {
    await runMigrationsNode(pool);
    console.log('[pretest] ✅ Test database migrations complete.');
  } catch (err: any) {
    console.error('[pretest] ❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

