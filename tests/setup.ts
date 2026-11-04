/**
 * Vitest global test setup.
 * Loads environment variables from .env.test if present.
 */
import { config } from 'dotenv';

config({ path: '.env.test', override: false });
config({ path: '.env', override: false });

if (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST;
}
