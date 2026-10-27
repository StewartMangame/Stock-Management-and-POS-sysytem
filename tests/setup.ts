/**
 * Vitest global test setup.
 * Loads environment variables from .env.test if present.
 */
import { config } from 'dotenv';

config({ path: '.env.test', override: false });
config({ path: '.env', override: false });
