/**
 * Database Role Privilege Verification & Hardening (Phase 6, Item B.7).
 *
 * This script:
 *  1. Shows the current role that the application connects as.
 *  2. Checks privileges on audit_log and journal tables.
 *  3. Verifies immutability triggers exist.
 *  4. Shows the \dp equivalent output for these tables.
 *
 * Run: npx tsx scripts/verify-db-role-privileges.ts
 */

import 'dotenv/config';
import { db } from '../src/server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  DATABASE ROLE PRIVILEGE VERIFICATION');
  console.log('════════════════════════════════════════════════════════════════════\n');

  // 1. Current role
  const roleRes = await db.execute<{ current_role: string; current_user: string }>(sql`
    SELECT current_role, current_user
  `);
  const { current_role, current_user } = roleRes.rows[0]!;
  console.log(`Connected as:  user = ${current_user},  role = ${current_role}\n`);

  // 2. Table privileges on audit_log and journal tables (\dp equivalent)
  const tables = ['audit_log', 'journal_batches', 'journal_lines'];
  console.log('── Table Privileges (\\dp equivalent) ───────────────────────────────');
  for (const tbl of tables) {
    const privRes = await db.execute<{
      grantee: string;
      privilege_type: string;
      is_grantable: string;
    }>(sql`
      SELECT
        grantee,
        privilege_type,
        is_grantable
      FROM information_schema.role_table_grants
      WHERE table_name = ${tbl}
        AND table_schema = 'public'
      ORDER BY grantee, privilege_type
    `);
    console.log(`\nTable: ${tbl}`);
    if (privRes.rows.length === 0) {
      console.log('  (no explicit grants — using default privileges only)');
    } else {
      console.table(privRes.rows);
    }

    // Check for dangerous privileges on current role
    const dangerous = privRes.rows.filter(
      (r) =>
        (r.privilege_type === 'UPDATE' ||
         r.privilege_type === 'DELETE' ||
         r.privilege_type === 'TRUNCATE') &&
        r.grantee === current_role,
    );
    if (dangerous.length > 0) {
      console.error(`  ❌ DANGER: ${current_role} has ${dangerous.map((d) => d.privilege_type).join(', ')} on ${tbl}!`);
    } else {
      console.log(`  ✅ ${current_role} does NOT have UPDATE/DELETE/TRUNCATE on ${tbl}`);
    }
  }

  // 3. Immutability triggers
  console.log('\n── Immutability Triggers ───────────────────────────────────────────');
  const trigRes = await db.execute<{
    trigger_name: string;
    event_object_table: string;
    event_manipulation: string;
    action_timing: string;
  }>(sql`
    SELECT
      trigger_name,
      event_object_table,
      event_manipulation,
      action_timing
    FROM information_schema.triggers
    WHERE event_object_table IN ('audit_log', 'journal_batches', 'journal_lines')
      AND event_object_schema = 'public'
    ORDER BY event_object_table, trigger_name
  `);
  if (trigRes.rows.length === 0) {
    console.error('  ❌ No immutability triggers found on audit_log or journal tables!');
  } else {
    console.table(trigRes.rows);
    console.log('  ✅ Immutability triggers present');
  }

  // 4. Try INSERT, then UPDATE, then DELETE on audit_log to prove trigger behavior
  console.log('\n── Testing audit_log INSERT & trigger immutability ──────────────────');
  let testRowId: string | null = null;
  try {
    const insertRes = await db.execute<{ id: string }>(sql`
      INSERT INTO audit_log (user_id, action, entity_type, entity_id, at)
      VALUES (NULL, 'privilege_verification_test', 'system', gen_random_uuid(), NOW())
      RETURNING id
    `);
    testRowId = insertRes.rows[0]?.id || null;
    console.log(`  ✅ INSERT on audit_log succeeded (row ID: ${testRowId})`);
  } catch (e: any) {
    console.error(`  ❌ INSERT on audit_log failed: ${e.message}`);
  }

  if (testRowId) {
    try {
      await db.execute(sql`
        UPDATE audit_log SET action = 'tamper_test' WHERE id = ${testRowId}::uuid
      `);
      console.error('  ❌ DANGER: UPDATE on audit_log succeeded! Trigger failed to block it!');
    } catch (e: any) {
      console.log(`  ✅ UPDATE on audit_log blocked by trigger: ${e.message}`);
    }

    try {
      await db.execute(sql`
        DELETE FROM audit_log WHERE id = ${testRowId}::uuid
      `);
      console.error('  ❌ DANGER: DELETE on audit_log succeeded! Trigger failed to block it!');
    } catch (e: any) {
      console.log(`  ✅ DELETE on audit_log blocked by trigger: ${e.message}`);
    }
  }

  console.log('\n════════════════════════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('[verify-db-role-privileges] Fatal:', e.message);
  process.exit(1);
});

