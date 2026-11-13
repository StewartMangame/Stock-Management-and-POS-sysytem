/**
 * Node-postgres (pg) migration runner.
 *
 * Used by run-migrate-test.ts for the local Docker Postgres test database.
 * The main production runner (run-migrate.ts) uses @neondatabase/serverless.
 *
 * Both call the same SQL files from src/server/db/migrations/ in order.
 */
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import type { Pool } from 'pg';

const MIGRATIONS_DIR = path.join(process.cwd(), 'src', 'server', 'db', 'migrations');

export async function runMigrationsNode(pool: Pool): Promise<void> {
  // Tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const filename of files) {
    const { rows } = await pool.query<{ filename: string }>(
      'SELECT filename FROM _migrations WHERE filename = $1',
      [filename],
    );

    if (rows.length > 0) continue; // already applied

    const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      console.log(`[migrate] applied: ${filename}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration failed: ${filename}\n${String(err)}`);
    } finally {
      client.release();
    }
  }
}

