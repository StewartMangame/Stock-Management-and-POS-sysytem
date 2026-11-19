import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Diagnostic environment check route.
 * Returns boolean availability and non-sensitive configuration status.
 * NEVER returns secret values or passwords.
 */
export async function GET() {
  const authSecret = process.env.AUTH_SECRET;
  const nextAuthSecret = process.env.NEXTAUTH_SECRET;
  const dbUrl = process.env.DATABASE_URL;

  // List all environment variable names (keys only, never values)
  const allKeys = Object.keys(process.env).sort();
  const authRelatedKeys = allKeys.filter((k) => k.toUpperCase().includes('AUTH'));

  return NextResponse.json({
    status: 'ok',
    hasAuthSecret: !!authSecret && authSecret.length > 0,
    authSecretLength: authSecret ? authSecret.length : 0,
    hasNextAuthSecret: !!nextAuthSecret && nextAuthSecret.length > 0,
    hasDatabaseUrl: !!dbUrl && dbUrl.length > 0,
    hasAuthUrl: !!process.env.AUTH_URL,
    authUrl: process.env.AUTH_URL ?? null,
    authTrustHost: process.env.AUTH_TRUST_HOST ?? null,
    appEnv: process.env.APP_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    vercel: !!process.env.VERCEL,
    vercelProjectName: process.env.VERCEL_PROJECT_NAME ?? null,
    authRelatedKeys,
    allKeysSafe: allKeys.filter(
      (k) =>
        !k.includes('SECRET') &&
        !k.includes('PASS') &&
        !k.includes('KEY') &&
        !k.includes('URL') &&
        !k.includes('TOKEN'),
    ),
  });
}
