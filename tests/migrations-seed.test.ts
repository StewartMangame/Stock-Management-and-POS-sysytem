/**
 * Integration test: migrations + seed on an empty database.
 *
 * Proves that:
 *   1. All SQL migrations run cleanly on an empty PostgreSQL schema.
 *   2. The seed script inserts all required baseline data.
 *   3. The seed is idempotent (running twice does not error or duplicate data).
 *   4. Expected rows exist and have the right values.
 *
 * Prerequisites:
 *   - Set DATABASE_URL_TEST in .env.test to a dedicated test database.
 *   - The test database must be accessible and the user must have CREATE TABLE rights.
 *   - Each run drops and recreates the test schema for a clean slate.
 *
 * Skip gracefully when DATABASE_URL_TEST is not set (CI opt-in).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import { runMigrations } from '@/server/db/migrate';
import * as schema from '@/server/db/schema';
import { eq, count } from 'drizzle-orm';

neonConfig.webSocketConstructor = ws;

const TEST_DB_URL = process.env['DATABASE_URL_TEST'];

const describeIf = TEST_DB_URL ? describe : describe.skip;

describeIf('Migrations + seed integration', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    if (!TEST_DB_URL) return;

    pool = new Pool({ connectionString: TEST_DB_URL });

    // Wipe the database so we start from a clean state
    await pool.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO PUBLIC;
    `);

    // Run all migrations
    await runMigrations(pool);

    // Seed the database using a fresh import to pick up the wiped state
    process.env['DATABASE_URL'] = TEST_DB_URL;
    process.env['ADMIN_SEED_PASSWORD'] = 'TestPass1!';

    // Dynamic import so that the seed uses the test database URL
    const { runSeed } = await import('@/server/db/seed');
    await runSeed();

    db = drizzle({ client: pool, schema });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  // ── Migration checks ───────────────────────────────────────────────────────

  it('creates the locations table', async () => {
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'locations'`,
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
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'login_attempts'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it('enables the citext extension', async () => {
    const result = await pool.query(
      `SELECT extname FROM pg_extension WHERE extname = 'citext'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  // ── Seed checks ────────────────────────────────────────────────────────────

  it('seeds all 6 roles', async () => {
    const result = await db
      .select({ total: count() })
      .from(schema.roles);
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
    expect(viewerRole!.permissions).not.toContain('invoices:void');
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

  it('seeds all 7 number sequences for MAIN location', async () => {
    const result = await db
      .select({ total: count() })
      .from(schema.numberSequences);
    expect(result[0]?.total).toBe(7);
  });

  it('seeds the invoice number sequence starting at 1 with prefix MAIN-INV', async () => {
    const seq = await db.query.numberSequences.findFirst({
      where: eq(schema.numberSequences.docType, 'invoice'),
    });
    expect(seq).toBeDefined();
    expect(seq!.prefix).toBe('MAIN-INV');
    expect(seq!.nextNumber).toBe(1);
    expect(seq!.padding).toBe(4);
  });

  it('seeds default settings including company_name', async () => {
    const setting = await db.query.settings.findFirst({
      where: eq(schema.settings.key, 'company_name'),
    });
    expect(setting).toBeDefined();
    expect(setting!.value).toBe('Ace Holdings Limited');
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
    expect(admin!.passwordHash).not.toBe('TestPass1!'); // must be hashed
    expect(admin!.passwordHash.length).toBeGreaterThan(20);
  });

  // ── Idempotency check ──────────────────────────────────────────────────────

  it('seed is idempotent — running twice does not create duplicate roles', async () => {
    const { runSeed } = await import('@/server/db/seed');
    await runSeed(); // second run

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
