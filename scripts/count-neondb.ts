import 'dotenv/config';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function check() {
  const prodUrl = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString: prodUrl });
  try {
    const taxRates = await pool.query('SELECT count(*)::int as c FROM tax_rates');
    const invoices = await pool.query("SELECT count(*)::int as c FROM sales_documents WHERE document_type = 'invoice'");
    const users = await pool.query('SELECT count(*)::int as c FROM users');
    console.log({
      tax_rates_count: taxRates.rows[0].c,
      invoices_count: invoices.rows[0].c,
      users_count: users.rows[0].c,
    });
  } finally {
    await pool.end();
  }
}

check().catch(console.error);

