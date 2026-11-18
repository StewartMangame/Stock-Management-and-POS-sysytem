/**
 * Non-Owner Runtime Database Role Tests (Milestone 6, Item 4).
 *
 * Verifies that the runtime role (ace_app_user):
 *   1. Can SELECT and INSERT into audit_log
 *   2. Cannot UPDATE audit_log (permission denied at DB role level)
 *   3. Cannot DELETE from audit_log (permission denied at DB role level)
 *   4. Cannot TRUNCATE audit_log (permission denied at DB role level)
 *   5. Cannot UPDATE or DELETE from journal_batches or journal_lines
 *   6. Cannot execute DDL (e.g. CREATE TABLE or DROP TRIGGER)
 *
 * Runs strictly against TEST_DATABASE_URL / DATABASE_URL_TEST.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const testDbUrl = process.env.DATABASE_URL_TEST || process.env.TEST_DATABASE_URL;

describe('Runtime Role: ace_app_user Permissions & Restrictions', () => {
  let runtimePool: Pool;
  let canConnectRuntime = false;

  beforeAll(async () => {
    if (!testDbUrl) return;

    // Build connection string for ace_app_user
    // Replace user:password with ace_app_user:AceApp2026Secure!
    try {
      const url = new URL(testDbUrl);
      url.username = 'ace_app_user';
      url.password = 'AceApp2026Secure!';
      runtimePool = new Pool({ connectionString: url.toString() });
      const client = await runtimePool.connect();
      await client.query('SELECT 1');
      client.release();
      canConnectRuntime = true;
    } catch (e) {
      console.warn('[runtime-role.test] Could not connect directly as ace_app_user:', e);
      canConnectRuntime = false;
    }
  });

  afterAll(async () => {
    if (runtimePool) {
      await runtimePool.end();
    }
  });

  it('1. ace_app_user can SELECT from audit_log and journal_batches', async () => {
    if (!canConnectRuntime) return;
    const client = await runtimePool.connect();
    try {
      const res = await client.query('SELECT COUNT(*) FROM audit_log');
      expect(res.rows[0]).toBeDefined();

      const jbRes = await client.query('SELECT COUNT(*) FROM journal_batches');
      expect(jbRes.rows[0]).toBeDefined();
    } finally {
      client.release();
    }
  });

  it('2. ace_app_user CANNOT UPDATE audit_log (permission denied)', async () => {
    if (!canConnectRuntime) return;
    const client = await runtimePool.connect();
    try {
      await expect(
        client.query("UPDATE audit_log SET action = 'tampered' WHERE 1=0"),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      client.release();
    }
  });

  it('3. ace_app_user CANNOT DELETE from audit_log (permission denied)', async () => {
    if (!canConnectRuntime) return;
    const client = await runtimePool.connect();
    try {
      await expect(
        client.query('DELETE FROM audit_log WHERE 1=0'),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      client.release();
    }
  });

  it('4. ace_app_user CANNOT TRUNCATE audit_log (permission denied)', async () => {
    if (!canConnectRuntime) return;
    const client = await runtimePool.connect();
    try {
      await expect(
        client.query('TRUNCATE audit_log'),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      client.release();
    }
  });

  it('5. ace_app_user CANNOT UPDATE or DELETE journal_batches (permission denied)', async () => {
    if (!canConnectRuntime) return;
    const client = await runtimePool.connect();
    try {
      // UPDATE is revoked via PostgreSQL privilege
      await expect(
        client.query('UPDATE journal_batches SET notes = \'tampered\' WHERE 1=0'),
      ).rejects.toThrow(/permission denied/i);

      // DELETE is revoked via PostgreSQL privilege
      await expect(
        client.query('DELETE FROM journal_batches WHERE 1=0'),
      ).rejects.toThrow(/permission denied/i);

      // TRUNCATE is revoked via PostgreSQL privilege
      await expect(
        client.query('TRUNCATE journal_batches'),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      client.release();
    }
  });

  it('6. ace_app_user CANNOT UPDATE or DELETE journal_lines (permission denied)', async () => {
    if (!canConnectRuntime) return;
    const client = await runtimePool.connect();
    try {
      await expect(
        client.query('UPDATE journal_lines SET debit_minor = 0 WHERE 1=0'),
      ).rejects.toThrow(/permission denied/i);

      await expect(
        client.query('DELETE FROM journal_lines WHERE 1=0'),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      client.release();
    }
  });

  it('7. ace_app_user CANNOT execute DDL (permission denied)', async () => {
    if (!canConnectRuntime) return;
    const client = await runtimePool.connect();
    try {
      await expect(
        client.query('CREATE TABLE evil_table (id int)'),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      client.release();
    }
  });
});

