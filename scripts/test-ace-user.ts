import 'dotenv/config';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function check() {
  const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST;
  if (!testDbUrl) {
    console.error('TEST_DATABASE_URL not set');
    process.exit(1);
  }
  const url = new URL(testDbUrl);
  url.username = 'ace_app_user';
  url.password = 'AceApp2026Secure!';

  console.log('Connecting as ace_app_user to:', url.pathname);
  const pool = new Pool({ connectionString: url.toString() });
  try {
    const res = await pool.query('SELECT current_user, current_database()');
    console.log('Connected successfully:', res.rows[0]);
  } finally {
    await pool.end();
  }
}

check().catch(err => {
  console.error('Connection failed:', err);
  process.exit(1);
});

