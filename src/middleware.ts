/**
 * Next.js middleware — authentication and route guard.
 *
 * Imports from auth.config.ts (edge-safe, no argon2/Node.js deps)
 * so this file can run on the Vercel Edge Runtime.
 *
 * The authorized() callback in authConfig handles all redirect logic.
 */
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

export const { auth: middleware } = NextAuth(authConfig);

export default middleware;

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/).*)'],
};
