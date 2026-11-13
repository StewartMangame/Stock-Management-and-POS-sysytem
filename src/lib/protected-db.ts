/**
 * Protected Database Guard.
 * Refuses destructive actions (resets, demo wipes, truncate) against protected database hosts.
 */

import { getAppEnv } from './env';

export function assertNotProtectedDatabase(databaseUrl: string | undefined, actionDescription: string): void {
  if (!databaseUrl || databaseUrl.trim() === '') {
    throw new Error(`[PROTECTED DB GUARD] Database URL is not provided for: ${actionDescription}`);
  }

  const appEnv = getAppEnv();
  if (appEnv === 'production' || appEnv === 'staging') {
    throw new Error(
      `[PROTECTED DB GUARD] Refusing ${actionDescription} in ${appEnv.toUpperCase()} environment (APP_ENV=${appEnv}).`,
    );
  }

  let host: string;
  try {
    const parsed = new URL(databaseUrl);
    host = parsed.hostname.toLowerCase();
  } catch (err: any) {
    throw new Error(`[PROTECTED DB GUARD] Malformed database URL: ${err.message}`);
  }

  // 1. Check against PROTECTED_DB_HOSTS list
  const protectedHostsEnv = process.env.PROTECTED_DB_HOSTS || '';
  const protectedHosts = protectedHostsEnv
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  if (protectedHosts.includes(host)) {
    throw new Error(
      `[PROTECTED DB GUARD] Refusing ${actionDescription}. Target host "${host}" is in PROTECTED_DB_HOSTS.`,
    );
  }

  // 2. Reject any host that matches common production naming patterns unless local
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  if (!isLocal && (host.includes('prod') || host.includes('production') || host.includes('live'))) {
    throw new Error(
      `[PROTECTED DB GUARD] Refusing ${actionDescription}. Target host "${host}" appears to be a production database.`,
    );
  }
}

