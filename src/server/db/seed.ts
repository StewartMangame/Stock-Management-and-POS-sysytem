/**
 * Idempotent seed script for Ace Holdings POS.
 *
 * Creates:
 *   - Roles with permissions
 *   - One location: Main Outlet (MAIN)
 *   - Default VAT rate: 17.5%
 *   - Default settings
 *   - Number sequences for all document types
 *   - Admin user (forcePasswordChange = true)
 *
 * Run with:  npm run db:seed
 * Run with a custom .env:  tsx --env-file=.env src/server/db/seed.ts
 *
 * Safe to run multiple times — uses ON CONFLICT DO NOTHING or DO UPDATE.
 */

import 'dotenv/config';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { eq, and } from 'drizzle-orm';
import ws from 'ws';
import { hash } from '@node-rs/argon2';
import {
  locations,
  roles,
  users,
  settings,
  taxRates,
  numberSequences,
  type SettingKey,
} from './schema';
import { ROLE_PERMISSIONS } from '../../lib/permissions';

neonConfig.webSocketConstructor = ws;

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // ── PRODUCTION GUARD ──────────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[seed] REFUSED: Demo seed scripts must not run in NODE_ENV=production. ' +
      'Use a proper migration and secure user-creation process for production environments.',
    );
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const adminPassword = process.env.ADMIN_SEED_PASSWORD;
  if (!adminPassword) throw new Error('ADMIN_SEED_PASSWORD is not set');

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle({ client: pool, schema: { locations, roles, users, settings, taxRates, numberSequences } });

  console.warn('[seed] Starting idempotent seed…');

  // ── 1. Roles ──────────────────────────────────────────────────────────────

  const roleNames = ['admin', 'manager', 'sales', 'storekeeper', 'cashier', 'viewer'] as const;

  const roleMap: Record<string, string> = {};

  for (const name of roleNames) {
    const perms = ROLE_PERMISSIONS[name] ?? [];
    const [row] = await db
      .insert(roles)
      .values({ name, permissions: perms })
      .onConflictDoUpdate({
        target: roles.name,
        set: { permissions: perms, updatedAt: new Date() },
      })
      .returning({ id: roles.id });
    if (row) roleMap[name] = row.id;
    console.warn(`[seed] role: ${name}`);
  }

  // ── 2. Location ───────────────────────────────────────────────────────────

  const [location] = await db
    .insert(locations)
    .values({
      name: 'Main Outlet',
      code: 'MAIN',
      type: 'outlet',
      address: 'First House, Plot Number BC52/53, Livingstone Avenue, Blantyre',
      isActive: true,
    })
    .onConflictDoUpdate({
      target: locations.code,
      set: { name: 'Main Outlet', updatedAt: new Date() },
    })
    .returning({ id: locations.id });

  if (!location) throw new Error('Failed to insert location');
  const locationId = location.id;
  console.warn(`[seed] location: Main Outlet (${locationId})`);

  // ── 3. Tax rate ───────────────────────────────────────────────────────────

  // Drizzle doesn't support ON CONFLICT on partial indexes; use raw upsert logic.
  const existingVat = await db.query.taxRates.findFirst({
    where: and(eq(taxRates.name, 'VAT'), eq(taxRates.rateBasisPoints, 1750)),
  });

  if (!existingVat) {
    await db.insert(taxRates).values({
      name: 'VAT',
      rateBasisPoints: 1750, // 17.5%
      isDefault: true,
      isActive: true,
    });
    console.warn('[seed] tax rate: VAT 17.5%');
  } else {
    console.warn('[seed] tax rate: VAT 17.5% (already exists)');
  }

  // ── 4. Settings ───────────────────────────────────────────────────────────

  const defaultSettings: Array<{ key: SettingKey; value: unknown }> = [
    { key: 'default_currency', value: 'MWK' },
    { key: 'allow_negative_stock', value: false },
    { key: 'costing_method', value: 'average' },
    { key: 'max_discount_percent_without_approval', value: 10 },
    { key: 'quotation_valid_days', value: 14 },
    { key: 'prices_include_tax', value: false },
    { key: 'company_name', value: 'Ace Holdings Limited' },
    { key: 'company_address', value: 'First House, Plot Number BC52/53, Livingstone Avenue, P.O. Box 1246, Blantyre' },
    { key: 'company_phone', value: '0888216263' },
    { key: 'company_email', value: 'ace@ace.co.mw' },
    { key: 'company_tax_number', value: '' },
    { key: 'eis_enabled', value: false },
  ];

  for (const s of defaultSettings) {
    await db
      .insert(settings)
      .values({ key: s.key, value: s.value })
      .onConflictDoNothing({ target: settings.key });
  }
  console.warn(`[seed] settings: ${defaultSettings.length} defaults inserted`);

  // ── 5. Number sequences ───────────────────────────────────────────────────

  const docTypes: Array<{ docType: string; prefix: string }> = [
    { docType: 'quotation', prefix: 'MAIN-QT' },
    { docType: 'invoice', prefix: 'MAIN-INV' },
    { docType: 'credit_note', prefix: 'MAIN-CN' },
    { docType: 'delivery_note', prefix: 'MAIN-DN' },
    { docType: 'purchase_order', prefix: 'MAIN-PO' },
    { docType: 'goods_receipt', prefix: 'MAIN-GRN' },
    { docType: 'payment', prefix: 'MAIN-PAY' },
  ];

  for (const seq of docTypes) {
    // ON CONFLICT on the composite unique index (doc_type, location_id)
    // Use raw SQL upsert to avoid Drizzle composite-index target issues
    await pool.query(
      `INSERT INTO number_sequences (doc_type, location_id, prefix, next_number, padding)
       VALUES ($1, $2, $3, 1, 4)
       ON CONFLICT (doc_type, location_id) DO NOTHING`,
      [seq.docType, locationId, seq.prefix],
    );
  }
  console.warn(`[seed] number sequences: ${docTypes.length} sequences`);

  // ── 6. Admin user ─────────────────────────────────────────────────────────

  const adminRoleId = roleMap['admin'];
  if (!adminRoleId) throw new Error('Admin role not found after insert');

  const passwordHash = await hash(adminPassword, {
    memoryCost: 65536,   // 64 MiB
    timeCost: 3,
    parallelism: 1,
  });

  const existingAdmin = await db.query.users.findFirst({
    where: eq(users.email, 'admin@ace.co.mw'),
  });

  if (!existingAdmin) {
    await db.insert(users).values({
      name: 'System Admin',
      email: 'admin@ace.co.mw',
      passwordHash,
      roleId: adminRoleId,
      defaultLocationId: locationId,
      isActive: true,
      forcePasswordChange: true, // must change on first login
    });
    console.warn('[seed] admin user: created (force_password_change=true)');
  } else {
    console.warn('[seed] admin user: already exists, skipping');
  }

  console.warn('[seed] Done.');
  await pool.end();
}

main().catch((err) => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Export for integration tests
// ─────────────────────────────────────────────────────────────────────────────

export { main as runSeed };
