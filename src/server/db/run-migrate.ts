import 'dotenv/config';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { runMigrations } from './migrate';

neonConfig.webSocketConstructor = ws;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: databaseUrl });

  // Check existing tables
  const { rows } = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  console.log('Existing tables in public schema:', rows.map((r) => r.tablename));

  // If tables already exist but _migrations is empty, mark 0000 and 0001 as applied if tables exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  if (rows.some((r) => r.tablename === 'users')) {
    await pool.query(`
      INSERT INTO _migrations (filename) VALUES ('0000_extensions.sql') ON CONFLICT DO NOTHING;
      INSERT INTO _migrations (filename) VALUES ('0001_setup_tables.sql') ON CONFLICT DO NOTHING;
    `);
  }

  console.log('Running pending migrations...');
  await runMigrations(pool);
  console.log('Migrations complete.');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
