import 'dotenv/config';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { runMigrations } from '../src/server/db/migrate';

neonConfig.webSocketConstructor = ws;

async function main() {
  const testDbUrl = process.env.DATABASE_URL_TEST || process.env.TEST_DATABASE_URL;
  if (!testDbUrl) throw new Error('DATABASE_URL_TEST is not set');

  console.log('Connecting to testdb...');
  const pool = new Pool({ connectionString: testDbUrl });

  console.log('Running migrations on testdb...');
  await runMigrations(pool);
  console.log('Migrations complete on testdb!');
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed on testdb:', err);
  process.exit(1);
});

