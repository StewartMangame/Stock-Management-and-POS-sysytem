import 'dotenv/config';
import readline from 'node:readline';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { runMigrations } from './migrate';

neonConfig.webSocketConstructor = ws;

async function askConfirmation(promptText: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  // 1. Strictly require MIGRATION_DATABASE_URL (remove DATABASE_URL fallback)
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl || migrationUrl.trim() === '') {
    throw new Error(
      'MIGRATION_DATABASE_URL is not set. Migrations must connect as the database owner via direct unpooled connection. (DATABASE_URL fallback is disabled).',
    );
  }

  // 2. Parse URL and extract Host and Database
  let parsed: URL;
  try {
    parsed = new URL(migrationUrl);
  } catch (err: any) {
    throw new Error(`Invalid MIGRATION_DATABASE_URL: ${err.message}`);
  }

  const host = parsed.hostname;
  const dbName = parsed.pathname.replace(/^\//, '');

  console.log('\n=== Database Migration Runner ===');
  console.log('Target Host:    ', host);
  console.log('Target Database:', dbName);

  // 3. For non-local databases, require typing the database name
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  if (!isLocal) {
    const autoConfirm = process.env.CONFIRM_DB_NAME;
    if (autoConfirm === dbName) {
      console.log('Database confirmed via CONFIRM_DB_NAME environment variable.');
    } else {
      console.log(`\n⚠️  You are migrating a REMOTE database: "${dbName}" on "${host}"`);
      const enteredName = await askConfirmation(
        `Type the database name ("${dbName}") to proceed with migrations: `,
      );

      if (enteredName !== dbName) {
        console.error('Database name confirmation mismatch. Migration aborted.');
        process.exit(1);
      }
    }
  }

  const pool = new Pool({ connectionString: migrationUrl });

  try {
    // 4. Verify connecting role is owner (refuse if connecting as ace_app_user or non-owner)
    const { rows: userRows } = await pool.query<{ current_user: string; is_owner: boolean }>(`
      SELECT 
        current_user,
        (pg_has_role(current_user, datdba, 'MEMBER') OR rolsuper) AS is_owner
      FROM pg_database, pg_roles
      WHERE datname = current_database() AND rolname = current_user
    `);

    const currentUser = userRows[0]?.current_user || 'unknown';
    const isOwner = Boolean(userRows[0]?.is_owner);

    console.log('Connecting Role:', currentUser);

    if (currentUser === 'ace_app_user' || !isOwner) {
      throw new Error(
        `Migration REFUSED: Connected as '${currentUser}', which is not the database owner. Migrations require the owner role.`,
      );
    }

    console.log('✓ Owner role verified.');

    // Check existing tables
    const { rows: tableRows } = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    console.log('Existing tables in public schema:', tableRows.map((r) => r.tablename));

    // Ensure _migrations table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    if (tableRows.some((r) => r.tablename === 'users')) {
      await pool.query(`
        INSERT INTO _migrations (filename) VALUES ('0000_extensions.sql') ON CONFLICT DO NOTHING;
        INSERT INTO _migrations (filename) VALUES ('0001_setup_tables.sql') ON CONFLICT DO NOTHING;
      `);
    }

    console.log('Running pending migrations...');
    await runMigrations(pool);
    console.log('✅ Migrations complete.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\n❌ Migration failed:', err.message || err);
  process.exit(1);
});
