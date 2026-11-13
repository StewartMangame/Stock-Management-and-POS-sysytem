/**
 * Integration test: migrations + seed on a throwaway database.
 *
 * Proves that:
 *   1. All SQL migrations run cleanly on an empty PostgreSQL schema.
 *   2. The production seed script inserts all required baseline data.
 *   3. The seed is idempotent (running twice does not error or duplicate data).
 *   4. Expected rows exist and have the right values.
 *
 * Uses MIGRATION_TEST_DB_URL — a SEPARATE database from the shared test DB —
 * so wiping its schema never touches other tests.
 *
 * With Docker Postgres (docker compose up -d):
 *   MIGRATION_TEST_DB_URL = postgresql://aceowner:aceowner@localhost:5433/acemigrationtest
 *
 * The test is skipped when MIGRATION_TEST_DB_URL is absent so the suite still
 * passes in environments that have only the shared test DB.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrationsNode } from '@/server/db/migrate-node';
import * as schema from '@/server/db/schema';
import { eq, count } from 'drizzle-orm';

// Use the dedicated throwaway database — never the shared test DB
const MIGRATION_TEST_DB_URL = process.env['MIGRATION_TEST_DB_URL'];

const describeIf = MIGRATION_TEST_DB_URL ? describe : describe.skip;

describeIf('Migrations + production-seed on a throwaway database', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: MIGRATION_TEST_DB_URL! });

    // Wipe the throwaway DB to a clean public schema
    await pool.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO PUBLIC;
    `);

    // Apply all migrations via the node-postgres runner
    await runMigrationsNode(pool);

    // Seed with production seed (not demo seed)
    process.env['DATABASE_URL'] = MIGRATION_TEST_DB_URL!;
    process.env['ADMIN_SEED_PASSWORD'] = process.env['ADMIN_SEED_PASSWORD'] || 'TestAdmin1!';

    const { runProductionSeed } = await import('@/server/db/seed-production');
    await runProductionSeed();

    db = drizzle(pool, { schema });
  }, 90_000);

  afterAll(async () => {
    await pool?.end();
  });

  // ── Migration structure checks ─────────────────────────────────────────────

  it('creates the locations table', async () => {
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'locations'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it('creates the users table with force_password_change column', async () => {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'force_password_change'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it('creates the login_attempts table', async () => {
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'login_attempts'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it('enables the citext extension', async () => {
    const result = await pool.query(
      `SELECT extname FROM pg_extension WHERE extname = 'citext'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it('creates the cron_runs table (migration 0013)', async () => {
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'cron_runs'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it('adds product_date column to products (migration 0012)', async () => {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'product_date'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it('adds image_url column to products (migration 0012)', async () => {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'image_url'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it('every migration file is tracked in _migrations', async () => {
    const { rows: migrated } = await pool.query<{ filename: string }>(
      `SELECT filename FROM _migrations ORDER BY filename`,
    );
    const { readdir } = await import('fs/promises');
    const path = await import('path');
    const dir = path.join(process.cwd(), 'src', 'server', 'db', 'migrations');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    expect(migrated.map((r) => r.filename)).toEqual(files);
  });

  // ── Production seed checks ─────────────────────────────────────────────────

  it('seeds all 6 roles', async () => {
    const result = await db.select({ total: count() }).from(schema.roles);
    expect(result[0]?.total).toBe(6);
  });

  it('seeds the admin role with all permissions', async () => {
    const adminRole = await db.query.roles.findFirst({
      where: eq(schema.roles.name, 'admin'),
    });
    expect(adminRole).toBeDefined();
    expect(adminRole!.permissions.length).toBeGreaterThan(0);
    expect(adminRole!.permissions).toContain('users:manage');
    expect(adminRole!.permissions).toContain('invoices:void');
  });

  it('seeds the viewer role with only read permissions', async () => {
    const viewerRole = await db.query.roles.findFirst({
      where: eq(schema.roles.name, 'viewer'),
    });
    expect(viewerRole).toBeDefined();
    expect(viewerRole!.permissions).not.toContain('users:manage');
    expect(viewerRole!.permissions).toContain('reports:view');
  });

  it('seeds the Main Outlet location with code MAIN', async () => {
    const loc = await db.query.locations.findFirst({
      where: eq(schema.locations.code, 'MAIN'),
    });
    expect(loc).toBeDefined();
    expect(loc!.name).toBe('Main Outlet');
    expect(loc!.type).toBe('outlet');
    expect(loc!.isActive).toBe(true);
  });

  it('seeds the default VAT rate at 17.5% (1750 basis points)', async () => {
    const vat = await db.query.taxRates.findFirst({
      where: eq(schema.taxRates.name, 'VAT'),
    });
    expect(vat).toBeDefined();
    expect(vat!.rateBasisPoints).toBe(1750);
    expect(vat!.isDefault).toBe(true);
    expect(vat!.isActive).toBe(true);
  });

  it('seeds 7 number sequences for MAIN location', async () => {
    const result = await db.select({ total: count() }).from(schema.numberSequences);
    expect(result[0]?.total).toBe(7);
  });

  it('seeds the invoice sequence starting at 1 with prefix MAIN-INV', async () => {
    const seq = await db.query.numberSequences.findFirst({
      where: eq(schema.numberSequences.docType, 'invoice'),
    });
    expect(seq).toBeDefined();
    expect(seq!.prefix).toBe('MAIN-INV');
    expect(seq!.nextNumber).toBe(1);
    expect(seq!.padding).toBe(4);
  });

  it('seeds company_name setting', async () => {
    const setting = await db.query.settings.findFirst({
      where: eq(schema.settings.key, 'company_name'),
    });
    expect(setting).toBeDefined();
  });

  it('seeds allow_negative_stock as false', async () => {
    const setting = await db.query.settings.findFirst({
      where: eq(schema.settings.key, 'allow_negative_stock'),
    });
    expect(setting).toBeDefined();
    expect(setting!.value).toBe(false);
  });

  it('seeds the admin user with forcePasswordChange=true', async () => {
    const admin = await db.query.users.findFirst({
      where: eq(schema.users.email, 'admin@ace.co.mw'),
    });
    expect(admin).toBeDefined();
    expect(admin!.forcePasswordChange).toBe(true);
    expect(admin!.isActive).toBe(true);
    expect(admin!.passwordHash).not.toMatch(/^TestAdmin/); // must be hashed
    expect(admin!.passwordHash.length).toBeGreaterThan(20);
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('seed is idempotent — running twice does not create duplicate roles', async () => {
    const { runProductionSeed } = await import('@/server/db/seed-production');
    await runProductionSeed(); // second run

    const result = await db.select({ total: count() }).from(schema.roles);
    expect(result[0]?.total).toBe(6); // still 6, not 12
  });

  it('seed is idempotent — running twice does not create a second admin user', async () => {
    const admins = await db.query.users.findMany({
      where: eq(schema.users.email, 'admin@ace.co.mw'),
    });
    expect(admins).toHaveLength(1);
  });
});
