import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { assertMocksAllowed, getAppEnv } from '../src/lib/env';
import { assertNotProtectedDatabase } from '../src/lib/protected-db';
import { verifyCronBearerSecret } from '../src/server/services/cron-helper';
import { GET as healthCheckGet } from '../src/app/api/health/route';
import { GET as cronEisGet } from '../src/app/api/cron/eis/route';
import { MockEisAdapter } from '../src/server/services/integrations/eis/mock';
import { getPaymentProvider } from '../src/server/services/integrations/onekhusa';
import { runProductionSeed } from '../src/server/db/seed-production';
import { db } from '../src/server/db';
import { locations, users, taxRates, unitsOfMeasure, numberSequences, customers, settings } from '../src/server/db/schema';
import { eq, and } from 'drizzle-orm';

describe('Deployment Readiness - Test Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // 1. Mock refused in production
  describe('1. Mock Guard in Production', () => {
    it('refuses assertMocksAllowed when APP_ENV=production', () => {
      process.env.APP_ENV = 'production';
      expect(() => assertMocksAllowed('Test Gateway')).toThrow(/strictly prohibited in production/i);
    });

    it('refuses MockEisAdapter instantiation when APP_ENV=production', () => {
      process.env.APP_ENV = 'production';
      expect(() => new MockEisAdapter()).toThrow(/strictly prohibited in production/i);
    });

    it('refuses OneKhusa mock payment provider when APP_ENV=production', () => {
      process.env.APP_ENV = 'production';
      process.env.ONEKHUSA_MODE = 'mock';
      expect(() => getPaymentProvider()).toThrow(/strictly prohibited in production/i);
    });

    it('permits mocks in local, test, or staging environments', () => {
      process.env.APP_ENV = 'test';
      expect(() => assertMocksAllowed('Test Gateway')).not.toThrow();

      process.env.APP_ENV = 'staging';
      expect(() => assertMocksAllowed('Test Gateway')).not.toThrow();

      process.env.APP_ENV = 'local';
      expect(() => assertMocksAllowed('Test Gateway')).not.toThrow();
    });
  });

  // 2. Health route makes no database call
  describe('2. Health Route (Liveness Probe)', () => {
    it('returns status ok without querying the database', async () => {
      const response = await healthCheckGet();
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json).toEqual({ status: 'ok' });
    });
  });

  // 3. Cron route returns 401 without secret
  describe('3. Cron Routes Authentication', () => {
    it('verifyCronBearerSecret returns false when CRON_SECRET is missing or wrong', () => {
      process.env.CRON_SECRET = 'super-secret-cron-token-12345';

      // No header
      const reqNoHeader = new Request('http://localhost/api/cron/eis');
      expect(verifyCronBearerSecret(reqNoHeader)).toBe(false);

      // Wrong token
      const reqWrong = new Request('http://localhost/api/cron/eis', {
        headers: { authorization: 'Bearer wrong-secret' },
      });
      expect(verifyCronBearerSecret(reqWrong)).toBe(false);

      // Valid Bearer token in constant time
      const reqValid = new Request('http://localhost/api/cron/eis', {
        headers: { authorization: 'Bearer super-secret-cron-token-12345' },
      });
      expect(verifyCronBearerSecret(reqValid)).toBe(true);
    });

    it('cron endpoint GET returns 401 Unauthorized without bearer token', async () => {
      process.env.CRON_SECRET = 'test-cron-secret-123';
      const req = new Request('http://localhost/api/cron/eis', { method: 'GET' });
      const res = await cronEisGet(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });
  });

  // 4. SET LOCAL used everywhere in transactions
  describe('4. SET LOCAL in Session & Transaction Settings', () => {
    it('verifies no bare SET statements exist in src/ and scripts/ for session/timeouts', () => {
      function scanDir(dir: string, fileList: string[] = []): string[] {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            if (file !== 'node_modules' && file !== '.next' && file !== '.git') {
              scanDir(filePath, fileList);
            }
          } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.sql')) {
            fileList.push(filePath);
          }
        }
        return fileList;
      }

      const files = [...scanDir('src'), ...scanDir('scripts')];
      const violations: string[] = [];

      // Regex matching bare "SET statement_timeout" or "SET TRANSACTION" without LOCAL
      const bareSetRegex = /\bSET\s+(?:statement_timeout|idle_in_transaction_session_timeout|timezone|TRANSACTION\s+READ)\b/i;
      const setLocalRegex = /\bSET\s+LOCAL\b/i;

      for (const f of files) {
        const content = fs.readFileSync(f, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          if (bareSetRegex.test(line) && !setLocalRegex.test(line)) {
            violations.push(`${f}:${i + 1} -> ${line.trim()}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  // 5. seed:production result verification
  describe('5. Production Seed Execution & Verification', () => {
    it('runs seed:production against test DB and verifies initial schema and seed state', async () => {
      process.env.ADMIN_SEED_PASSWORD = 'TestProdAdminPassword123!';
      await runProductionSeed();

      // Verify single primary location MAIN
      const [mainLoc] = await db.select().from(locations).where(eq(locations.code, 'MAIN'));
      expect(mainLoc).toBeDefined();
      expect(mainLoc?.name).toBe('Main Outlet');

      // Verify real admin user with forced password change
      const [adminUser] = await db.select().from(users).where(eq(users.email, 'admin@ace.co.mw'));
      expect(adminUser).toBeDefined();
      expect(adminUser?.forcePasswordChange).toBe(true);
      expect(adminUser?.isActive).toBe(true);

      // Verify single default VAT rate 17.5% (1750 bps)
      const activeRates = await db
        .select()
        .from(taxRates)
        .where(and(eq(taxRates.isActive, true), eq(taxRates.isDefault, true)));
      expect(activeRates.length).toBe(1);
      expect(activeRates[0]?.rateBasisPoints).toBe(1750);
      expect(activeRates[0]?.name).toBe('Standard VAT (17.5%)');

      // Verify units of measure
      const uoms = await db.select().from(unitsOfMeasure);
      const uomCodes = uoms.map((u) => u.code);
      expect(uomCodes).toContain('EA');
      expect(uomCodes).toContain('BOX');
      expect(uomCodes).toContain('M');
      expect(uomCodes).toContain('SET');

      // Verify number sequences
      const sequences = await db.select().from(numberSequences);
      expect(sequences.length).toBeGreaterThan(0);
      for (const seq of sequences) {
        expect(seq.nextNumber).toBeGreaterThanOrEqual(1);
      }

      // Verify walk-in customer exists
      const [walkIn] = await db.select().from(customers).where(eq(customers.isWalkIn, true));
      expect(walkIn).toBeDefined();

      // Verify blank standard company settings
      const [companyName] = await db.select().from(settings).where(eq(settings.key, 'company_name'));
      expect(companyName).toBeDefined();
      expect(typeof companyName?.value).toBe('string');
    });
  });

  // 6. Destructive scripts refuse protected hosts
  describe('6. Destructive Scripts & Protected DB Hosts Guard', () => {
    it('refuses when APP_ENV=production or APP_ENV=staging', () => {
      process.env.APP_ENV = 'production';
      expect(() =>
        assertNotProtectedDatabase(
          'postgresql://user:pass@localhost:5432/testdb',
          'clear-demo-data',
        ),
      ).toThrow(/Refusing clear-demo-data in PRODUCTION environment/i);

      process.env.APP_ENV = 'staging';
      expect(() =>
        assertNotProtectedDatabase(
          'postgresql://user:pass@localhost:5432/testdb',
          'reset-admin',
        ),
      ).toThrow(/Refusing reset-admin in STAGING environment/i);
    });

    it('refuses when host is listed in PROTECTED_DB_HOSTS', () => {
      process.env.APP_ENV = 'test';
      process.env.PROTECTED_DB_HOSTS = 'ep-prod-db.us-east-2.aws.neon.tech,prod.ace.co.mw';

      expect(() =>
        assertNotProtectedDatabase(
          'postgresql://user:pass@ep-prod-db.us-east-2.aws.neon.tech/neondb',
          'clear-demo-data',
        ),
      ).toThrow(/Target host "ep-prod-db.us-east-2.aws.neon.tech" is in PROTECTED_DB_HOSTS/i);
    });

    it('refuses when host name contains prod or live keywords', () => {
      process.env.APP_ENV = 'test';
      expect(() =>
        assertNotProtectedDatabase(
          'postgresql://user:pass@ep-live-sales-01.neon.tech/db',
          'clear-demo-data',
        ),
      ).toThrow(/appears to be a production database/i);
    });

    it('allows non-protected local databases in local or test environment', () => {
      process.env.APP_ENV = 'test';
      expect(() =>
        assertNotProtectedDatabase(
          'postgresql://user:pass@localhost:5432/local_test',
          'clear-demo-data',
        ),
      ).not.toThrow();

      process.env.APP_ENV = 'local';
      expect(() =>
        assertNotProtectedDatabase(
          'postgresql://user:pass@127.0.0.1:5432/local_dev',
          'clear-demo-data',
        ),
      ).not.toThrow();
    });
  });
});
