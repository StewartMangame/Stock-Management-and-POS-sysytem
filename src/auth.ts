/**
 * Full Auth.js v5 configuration — Node.js runtime only.
 *
 * Extends authConfig (edge-safe) with the Credentials provider that uses
 * argon2 for password verification and the Neon DB for user lookup.
 *
 * DO NOT import this file from middleware.ts — use auth.config.ts there.
 */

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { loginSchema } from '@/lib/validation';
import { checkLoginRateLimit, recordLoginAttempt } from '@/server/services/rate-limit';
import { authConfig } from '@/auth.config';

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,

  providers: [
    Credentials({
      name: 'Email and Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(credentials, req) {
        // 1. Validate input shape
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        // 2. Extract IP for rate limiting
        const forwarded = (req as Request).headers?.get?.('x-forwarded-for');
        const ip = forwarded?.split(',')[0]?.trim() ?? 'unknown';

        // 3. Rate limit: max 5 failed attempts per IP per 15 minutes
        const limited = await checkLoginRateLimit(ip, email);
        if (limited) {
          throw new Error('RateLimitExceeded');
        }

        // 4. Look up user with role
        const user = await db.query.users.findFirst({
          where: eq(users.email, email),
        });

        if (!user || !user.isActive) {
          await recordLoginAttempt(ip, email, false);
          return null;
        }

        // 5. Verify password
        const valid = await verify(user.passwordHash, password);
        if (!valid) {
          await recordLoginAttempt(ip, email, false);
          return null;
        }

        // 6. Record success and update last_login_at
        await Promise.all([
          recordLoginAttempt(ip, email, true),
          db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)),
        ]);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          roleId: user.roleId ?? '',
          forcePasswordChange: user.forcePasswordChange,
        };
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    /**
     * Extend the base jwt callback to handle trigger='update' (token refresh
     * after password change). Needs DB access so it lives here, not in auth.config.ts.
     */
    async jwt({ token, user, trigger }) {
      // Delegate base population to authConfig
      const base = authConfig.callbacks?.jwt;
      if (base) {
        token = (await base({ token, user, trigger, account: null })) ?? token;
      }

      // Re-read from DB when the client calls update() (e.g., after password change)
      if (trigger === 'update' && token.id) {
        const fresh = await db.query.users.findFirst({
          where: eq(users.id, token.id as string),
          columns: { roleId: true, forcePasswordChange: true, isActive: true },
        });
        if (fresh) {
          token.roleId = fresh.roleId ?? '';
          token.forcePasswordChange = fresh.forcePasswordChange;
          token.isActive = fresh.isActive;
        }
      }

      return token;
    },
  },
});
