/**
 * Vitest global test setup.
 * Loads environment variables from .env.test if present.
 * Enforces the global database safety guard BEFORE any test executes.
 */
import { config } from 'dotenv';
import { expect } from 'vitest';
import { assertSafeTestDatabase } from '../src/lib/test-guard';
import { unwrapDatabaseError } from '../src/server/db/errors';

config({ path: '.env.test', override: false });
config({ path: '.env', override: false });

const rawProdUrl = process.env.DATABASE_URL;
const rawTestUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST;

// Enforce test guard globally:
assertSafeTestDatabase(rawTestUrl, rawProdUrl);

// Ensure all DB clients during test execution connect ONLY to the test database
process.env.DATABASE_URL = rawTestUrl;
process.env.TEST_DATABASE_URL = rawTestUrl;
process.env.DATABASE_URL_TEST = rawTestUrl;

declare module 'vitest' {
  interface Assertion<T = any> {
    toThrowCause(expectedPattern?: string | RegExp): Promise<void> | void;
  }
  interface AsymmetricMatchersContaining {
    toThrowCause(expectedPattern?: string | RegExp): void;
  }
}

// Custom matcher to assert on unwrapped database error cause
expect.extend({
  toThrowCause(received: unknown, expectedPattern: string | RegExp) {
    let thrownError: any = null;
    if (typeof received === 'function') {
      try {
        received();
      } catch (e) {
        thrownError = e;
      }
    } else {
      thrownError = received;
    }

    if (!thrownError) {
      return {
        pass: false,
        message: () => `Expected function or promise to throw/reject, but nothing was thrown.`,
      };
    }

    const unwrapped = unwrapDatabaseError(thrownError);
    const candidateTexts = [unwrapped.message, unwrapped.safeUserMessage, thrownError.message].filter(Boolean);

    const matches = candidateTexts.some((txt) =>
      typeof expectedPattern === 'string'
        ? txt.includes(expectedPattern)
        : expectedPattern.test(txt),
    );

    return {
      pass: matches,
      message: () =>
        `Expected error or cause to match ${expectedPattern}, but got:\n  cause.message: "${unwrapped.message}"\n  safeUserMessage: "${unwrapped.safeUserMessage}"\n  error.message: "${thrownError.message}"`,
    };
  },
});

