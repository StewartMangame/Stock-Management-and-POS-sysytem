/**
 * Programmatic migration runner.
 * Reads SQL files from the migrations directory in order and executes them.
 * Used by the integration test to prove that migrations + seed run on an empty DB.
 *
 * For normal deployment use: npm run db:migrate  (drizzle-kit migrate)
 */
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import type { Pool } from '@neondatabase/serverless';

const MIGRATIONS_DIR = path.join(process.cwd(), 'src', 'server', 'db', 'migrations');

export async function runMigrations(pool: Pool): Promise<void> {
  // Ensure migration tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort(); // lexicographic order: 0000_..., 0001_..., etc.

  for (const filename of files) {
    const { rows } = await pool.query<{ filename: string }>(
      'SELECT filename FROM _migrations WHERE filename = $1',
      [filename],
    );

    if (rows.length > 0) {
      continue; // already applied
    }

    const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf-8');

    // Run each migration file in its own transaction
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations (filename) VALUES ($1)', [filename]);
      await pool.query('COMMIT');
      console.warn(`[migrate] applied: ${filename}`);
    } catch (err) {
      await pool.query('ROLLBACK');
      throw new Error(`Migration failed: ${filename}\n${String(err)}`);
    }
  }
}
