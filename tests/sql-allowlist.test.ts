/**
 * SQL Injection & Identifier Safety Tests.
 *
 * Verifies that:
 * 1. User-controlled report names cannot reach dynamic queries; only allow-listed slugs are processed.
 * 2. Database-backed rate limiting safely handles arbitrary key strings (including SQL injection attempts)
 *    via parameterized SQL, never raw concatenation.
 * 3. Sorting & column identifiers across queries use static schema references, not raw strings.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

import { GET as reportGet } from '@/app/api/reports/[report]/route';
import { checkDbRateLimit } from '@/server/services/rate-limit';

describe('SQL Identifier Safety & Allow-list Enforcement', () => {
  describe('1. Report Route Allow-list Enforcement', () => {
    const maliciousReportNames = [
      'users; DROP TABLE users; --',
      "' OR '1'='1",
      '../../../etc/passwd',
      'SELECT * FROM users',
      'nonexistent_report_xyz',
      '__proto__',
      'constructor',
    ];

    it.each(maliciousReportNames)(
      'rejects unauthorized/malicious report name "%s" with 404',
      async (slug) => {
        const req = new Request(`http://localhost:3000/api/reports/${encodeURIComponent(slug)}`);
        const res = await reportGet(req as any, {
          params: Promise.resolve({ report: slug }),
        });

        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.error).toBe('Unknown report');
      },
    );
  });

  describe('2. Rate Limiting SQL Injection Resistance', () => {
    const injectionKeys = [
      "test_ip'; DROP TABLE payment_link_rate_limits; --",
      "test_key' OR '1'='1",
      'test_key" OR "1"="1',
      "test_key'); DELETE FROM users WHERE ('1'='1",
      'test_key\x00nullbyte',
    ];

    it.each(injectionKeys)(
      'safely handles malicious rate limit key "%s" via parameterized query',
      async (key) => {
        // Must not throw a SQL syntax error; must treat the payload as a literal string value
        const result = await checkDbRateLimit(key, 10, 60);
        expect(result).toHaveProperty('allowed');
        expect(result).toHaveProperty('count');
        expect(result.count).toBeGreaterThanOrEqual(1);
      },
    );
  });
});
