/**
 * Database Test Guard
 *
 * Enforces that integration tests NEVER run against the production database.
 * Throws a fatal error if:
 *   1. TEST_DATABASE_URL (or DATABASE_URL_TEST) is missing or empty.
 *   2. TEST_DATABASE_URL equals DATABASE_URL.
 *   3. TEST_DATABASE_URL points to the same host AND database/schema as DATABASE_URL.
 */

export function assertSafeTestDatabase(
  testUrl: string | undefined,
  prodUrl: string | undefined,
): void {
  if (!testUrl || testUrl.trim() === '') {
    throw new Error(
      'FATAL TEST GUARD: TEST_DATABASE_URL is missing. Tests must never run without an isolated test database.',
    );
  }

  if (prodUrl && prodUrl.trim() !== '') {
    if (testUrl.trim() === prodUrl.trim()) {
      throw new Error(
        'FATAL TEST GUARD: TEST_DATABASE_URL equals DATABASE_URL. Tests are prohibited from targeting the production database.',
      );
    }

    try {
      const parsedTest = new URL(testUrl);
      const parsedProd = new URL(prodUrl);

      const testHost = parsedTest.hostname.toLowerCase();
      const prodHost = parsedProd.hostname.toLowerCase();
      const testDb = parsedTest.pathname.toLowerCase().replace(/^\//, '');
      const prodDb = parsedProd.pathname.toLowerCase().replace(/^\//, '');

      if (testHost === prodHost && testDb === prodDb) {
        throw new Error(
          `FATAL TEST GUARD: TEST_DATABASE_URL points to the same host (${testHost}) and database (${testDb}) as DATABASE_URL. Refusing to run tests against the main database.`,
        );
      }
    } catch (e: any) {
      if (e.message.startsWith('FATAL TEST GUARD:')) throw e;
      throw new Error(`FATAL TEST GUARD: Malformed database URL: ${e.message}`);
    }
  }
}

