import 'dotenv/config';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { hash, verify } from '@node-rs/argon2';

neonConfig.webSocketConstructor = ws;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const newPassword = process.env.ADMIN_SEED_PASSWORD || 'ChangeMe123!';

  console.log(`Hashing new password: ${newPassword}...`);
  const passwordHash = await hash(newPassword, {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });

  const isValid = await verify(passwordHash, newPassword);
  console.log(`Self-verification: ${isValid}`);

  const updateRes = await pool.query(
    'UPDATE users SET password_hash = $1, force_password_change = false WHERE email = $2 RETURNING id, email, name',
    [passwordHash, 'admin@ace.co.mw']
  );

  console.log('Update result:', updateRes.rows);

  // Clear any failed login attempts from rate limiting for this email
  await pool.query('DELETE FROM login_attempts WHERE email = $1', ['admin@ace.co.mw']);
  console.log('Cleared failed login attempts for admin@ace.co.mw');

  await pool.end();
  console.log('Admin password successfully reset to:', newPassword);
}

main().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
