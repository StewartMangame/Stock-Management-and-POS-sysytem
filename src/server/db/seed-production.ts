/**
 * Production Seed Script.
 * Provisions initial system requirements without demo, test, or sample data.
 *
 * Creates:
 *   1. Roles & permissions
 *   2. Single location: 'Main Outlet' (MAIN)
 *   3. Real admin user (password from ADMIN_SEED_PASSWORD, force_password_change = true)
 *   4. Single default VAT rate 17.5% (1750 basis points) - no other tax rates
 *   5. Standard settings with company details left blank
 *   6. Units of measure: Each, Box, Metre, Set
 *   7. Document number sequences starting at next_number = 1
 *   8. Default account mappings
 *   9. Verifies/creates system Walk-in Customer ('WALK-IN')
 *
 * Safe to run idempotently.
 */

import 'dotenv/config';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { eq, and, sql } from 'drizzle-orm';
import ws from 'ws';
import { hash } from '@node-rs/argon2';
import {
  locations,
  roles,
  users,
  settings,
  taxRates,
  numberSequences,
  accountMappings,
  unitsOfMeasure,
  customers,
  type SettingKey,
} from './schema';
import { DEFAULT_ACCOUNT_MAPPINGS } from '../services/accounting/journal-engine';
import { ROLE_PERMISSIONS } from '../../lib/permissions';

neonConfig.webSocketConstructor = ws;

export async function runProductionSeed(poolOverride?: any): Promise<void> {
  const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl && !poolOverride) {
    throw new Error('Database URL is not configured.');
  }

  const adminPassword = process.env.ADMIN_SEED_PASSWORD;
  if (!adminPassword || adminPassword.trim() === '') {
    throw new Error('ADMIN_SEED_PASSWORD is required for production seed.');
  }

  const pool = poolOverride || new Pool({ connectionString: databaseUrl });
  const db = drizzle({ client: pool });

  try {
    console.log('── Step 1: Provisioning Roles & Permissions ──');
    const roleIds: Record<string, string> = {};

    for (const [roleName, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      const [existing] = await db.select().from(roles).where(eq(roles.name, roleName));
      if (existing) {
        await db
          .update(roles)
          .set({ permissions: permissions as any, updatedAt: new Date() })
          .where(eq(roles.id, existing.id));
        roleIds[roleName] = existing.id;
      } else {
        const [inserted] = await db
          .insert(roles)
          .values({
            name: roleName,
            permissions: permissions as any,
          })
          .returning({ id: roles.id });
        roleIds[roleName] = inserted!.id;
      }
    }

    console.log('── Step 2: Provisioning Single Primary Location ──');
    let locationId: string;
    const [existingLocation] = await db.select().from(locations).where(eq(locations.code, 'MAIN'));
    if (existingLocation) {
      locationId = existingLocation.id;
    } else {
      const [newLoc] = await db
        .insert(locations)
        .values({
          name: 'Main Outlet',
          code: 'MAIN',
          type: 'outlet',
          address: '',
          isActive: true,
        })
        .returning({ id: locations.id });
      locationId = newLoc!.id;
    }

    console.log('── Step 3: Provisioning Real Admin User ──');
    const adminEmail = 'admin@ace.co.mw';
    const passwordHash = await hash(adminPassword, {
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });

    const [existingAdmin] = await db.select().from(users).where(eq(users.email, adminEmail));
    let adminUserId: string;

    if (existingAdmin) {
      adminUserId = existingAdmin.id;
      console.log('Admin user already exists.');
    } else {
      const [newAdmin] = await db
        .insert(users)
        .values({
          name: 'System Administrator',
          email: adminEmail,
          passwordHash,
          roleId: roleIds['admin'],
          defaultLocationId: locationId,
          forcePasswordChange: true,
          isActive: true,
        })
        .returning({ id: users.id });
      adminUserId = newAdmin!.id;
      console.log('✓ Admin user created with forced password change.');
    }

    console.log('── Step 4: Provisioning Single Default 17.5% VAT Rate ──');
    // Ensure no other tax rates are marked default before inserting/updating (respecting unique index)
    await db
      .update(taxRates)
      .set({ isDefault: false, isActive: false })
      .where(sql`name != 'Standard VAT (17.5%)'`);

    const [existingVat] = await db.select().from(taxRates).where(eq(taxRates.name, 'Standard VAT (17.5%)'));
    if (existingVat) {
      await db
        .update(taxRates)
        .set({ rateBasisPoints: 1750, isDefault: true, isActive: true })
        .where(eq(taxRates.id, existingVat.id));
    } else {
      await db.insert(taxRates).values({
        name: 'Standard VAT (17.5%)',
        rateBasisPoints: 1750,
        isDefault: true,
        isActive: true,
        createdBy: adminUserId,
      });
    }

    console.log('── Step 5: Provisioning Standard Blank Settings ──');
    const standardSettings: Record<SettingKey, string> = {
      default_currency: 'MWK',
      costing_method: 'perpetual_weighted_average',
      prices_include_tax: 'true',
      allow_negative_stock: 'false',
      max_discount_percent_without_approval: '10',
      quotation_valid_days: '30',
      company_name: '',
      company_address: '',
      company_phone: '',
      company_email: '',
      company_tax_number: '',
      eis_enabled: 'false',
      invoice_payment_instructions: '',
      reservation_hold_days: '14',
      pos_blind_cash_up: 'false',
      pos_return_window_days: '30',
      cost_variance_threshold_percent: '10',
      cost_above_selling_price_threshold_percent: '0',
    };

    for (const [key, value] of Object.entries(standardSettings)) {
      await db
        .insert(settings)
        .values({
          key: key as SettingKey,
          value,
          updatedBy: adminUserId,
        })
        .onConflictDoNothing();
    }

    console.log('── Step 6: Provisioning Standard Units of Measure ──');
    const uoms = [
      { name: 'Each', code: 'EA', symbol: 'ea', allowDecimal: false },
      { name: 'Box', code: 'BOX', symbol: 'bx', allowDecimal: false },
      { name: 'Metre', code: 'M', symbol: 'm', allowDecimal: true },
      { name: 'Set', code: 'SET', symbol: 'set', allowDecimal: false },
    ];

    for (const u of uoms) {
      await db
        .insert(unitsOfMeasure)
        .values({
          name: u.name,
          code: u.code,
          symbol: u.symbol,
          allowDecimal: u.allowDecimal,
          isActive: true,
        })
        .onConflictDoNothing({ target: unitsOfMeasure.code });
    }

    console.log('── Step 7: Provisioning Number Sequences starting at 1 ──');
    const docTypes = [
      { docType: 'quotation', prefix: 'QT-' },
      { docType: 'sales_order', prefix: 'SO-' },
      { docType: 'sales_document', prefix: 'INV-' },
      { docType: 'delivery_note', prefix: 'DN-' },
      { docType: 'credit_note', prefix: 'CN-' },
      { docType: 'payment', prefix: 'PAY-' },
      { docType: 'purchase_order', prefix: 'PO-' },
      { docType: 'goods_receipt', prefix: 'GRN-' },
      { docType: 'stock_adjustment', prefix: 'ADJ-' },
      { docType: 'stock_count', prefix: 'CNT-' },
      { docType: 'journal_batch', prefix: 'JB-' },
    ];

    for (const seq of docTypes) {
      await db
        .insert(numberSequences)
        .values({
          docType: seq.docType,
          locationId,
          prefix: seq.prefix,
          nextNumber: 1,
          padding: 4,
        })
        .onConflictDoNothing();
    }

    console.log('── Step 8: Provisioning Default Account Mappings ──');
    for (const mapping of DEFAULT_ACCOUNT_MAPPINGS) {
      await db
        .insert(accountMappings)
        .values({
          eventType: mapping.eventType,
          role: mapping.role,
          accountCode: mapping.accountCode,
          accountName: mapping.accountName,
          description: mapping.description,
          isPlaceholder: true,
          updatedBy: adminUserId,
        })
        .onConflictDoNothing();
    }

    console.log('── Step 9: Verifying System Walk-in Customer ──');
    const [existingWalkin] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.isWalkIn, true));

    if (!existingWalkin) {
      await db.insert(customers).values({
        accountNumber: 'WALK-IN',
        name: 'Walk-in Customer',
        customerType: 'walk_in',
        isWalkIn: true,
        creditLimitMinor: 0,
        paymentTermsDays: 0,
        isActive: true,
        createdBy: adminUserId,
      });
      console.log('✓ Walk-in customer created.');
    } else {
      console.log('✓ Walk-in customer exists.');
    }

    console.log('\n✅ Production seed completed successfully.');
  } finally {
    if (!poolOverride) {
      await pool.end();
    }
  }
}

if (process.argv[1]?.endsWith('seed-production.ts')) {
  runProductionSeed().catch((err) => {
    console.error('\n❌ Production seed failed:', err.message || err);
    process.exit(1);
  });
}
