/**
 * Vitest global test setup.
 * Loads environment variables from .env.test if present.
 * Enforces the global database safety guard BEFORE any test executes.
 */
import { config } from 'dotenv';
import { assertSafeTestDatabase } from '../src/lib/test-guard';

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
