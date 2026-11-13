/**
 * Environment configuration and deployment guards.
 */

export type AppEnvironment = 'local' | 'test' | 'staging' | 'production';

export function getAppEnv(): AppEnvironment {
  const env = (process.env.APP_ENV || (process.env.NODE_ENV === 'test' ? 'test' : 'local')).toLowerCase();

  if (env === 'production' || env === 'staging' || env === 'test' || env === 'local') {
    return env;
  }

  // If in deployed production runtime without valid APP_ENV, refuse to start
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `FATAL: Invalid APP_ENV="${env}". Must be one of: 'local', 'test', 'staging', 'production'.`,
    );
  }

  return 'local';
}

/**
 * Validates that APP_ENV is explicitly provided in deployed environments.
 * Called at application startup.
 */
export function validateEnvironment(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.APP_ENV) {
    throw new Error(
      'FATAL: APP_ENV is required in deployed production environments. Set APP_ENV to "staging" or "production".',
    );
  }
}

export function isProduction(): boolean {
  return getAppEnv() === 'production';
}

export function isStaging(): boolean {
  return getAppEnv() === 'staging';
}

/**
 * Ensures that mock services (payment providers, EIS) are strictly prohibited in production.
 */
export function assertMocksAllowed(serviceName: string): void {
  if (isProduction()) {
    throw new Error(
      `SECURITY ALERT: Mock ${serviceName} is strictly prohibited in production (APP_ENV=production). Real provider credentials are required.`,
    );
  }
}

