import * as dotenv from 'dotenv';
dotenv.config();
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function main() {
  const url = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString: url });
  try {
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM tax_rates) AS tax_rates_count,
        (SELECT COUNT(*) FROM sales_documents) AS sales_documents_count,
        (SELECT COUNT(*) FROM users) AS users_count;
    `);
    console.log('Production neondb counts:');
    console.table(r.rows);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);

