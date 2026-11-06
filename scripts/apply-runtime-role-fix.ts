import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import * as dotenv from 'dotenv';
dotenv.config();

neonConfig.webSocketConstructor = ws;

async function main() {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST;
  if (!url) {
    console.error('No test database url');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  try {
    console.log('Revoking CREATE on SCHEMA public FROM PUBLIC and ace_app_user...');
    await pool.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC;');
    await pool.query('REVOKE CREATE ON SCHEMA public FROM ace_app_user;');
    console.log('Done!');
  } finally {
    await pool.end();
  }
}

main().catch(console.error);

