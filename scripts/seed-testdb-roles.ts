/**
 * Seed standard roles into testdb if they are missing.
 * Safe to run multiple times — uses INSERT ... ON CONFLICT DO NOTHING.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool } from '@neondatabase/serverless';
import { roles } from '../src/server/db/schema';
import { ROLE_PERMISSIONS } from '../src/lib/permissions';
import { sql } from 'drizzle-orm';

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL_TEST;
if (!url) throw new Error('TEST_DATABASE_URL not set');

const pool = new Pool({ connectionString: url });
const db = drizzle(pool);

const ROLE_NAMES = ['admin', 'manager', 'sales', 'storekeeper', 'cashier', 'viewer'] as const;

async function main() {
  console.log('Seeding roles into testdb...');

  for (const name of ROLE_NAMES) {
    const permissions: string[] = name === 'admin'
      ? (ROLE_PERMISSIONS.admin as readonly string[]).slice()
      : ((ROLE_PERMISSIONS[name] ?? []) as readonly string[]).slice();

    // Check if role already exists
    const existing = await db
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(sql`${roles.name} = ${name}`)
      .limit(1);

    if (existing.length > 0) {
      // Update permissions to ensure they're current
      await db
        .update(roles)
        .set({ permissions })
        .where(sql`${roles.name} = ${name}`);
      console.log(`  [update] ${name} → ${permissions.length} permissions`);
    } else {
      const [inserted] = await db
        .insert(roles)
        .values({
          name,
          permissions,
        })
        .returning({ id: roles.id });
      console.log(`  [insert] ${name} → id=${inserted?.id}, ${permissions.length} permissions`);
    }
  }

  // Verify
  const all = await db.select({ id: roles.id, name: roles.name, count: sql<number>`array_length(${roles.permissions}, 1)` }).from(roles);
  console.log('\n=== Roles in testdb after seed ===');
  for (const r of all) {
    console.log(`  [${r.name}] id=${r.id}  permissions: ${r.count ?? 0}`);
  }
  console.log('\nDone.');
}

main().catch(console.error).finally(() => pool.end());

