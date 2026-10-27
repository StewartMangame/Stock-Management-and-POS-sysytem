/**
 * Edge-safe Auth.js configuration.
 *
 * This file MUST NOT import any Node.js-only modules (argon2, ws, pg, etc.)
 * because it is also used by Next.js middleware, which runs on the Edge runtime.
 *
 * The Credentials provider with argon2 verification lives in auth.ts only.
 */
import type { NextAuthConfig } from 'next-auth';

export const authConfig: NextAuthConfig = {
  session: { strategy: 'jwt' },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  /**
   * Providers are intentionally empty here.
   * They are added in auth.ts where argon2 / Node APIs are available.
   */
  providers: [],

  callbacks: {
    /**
     * Middleware-safe authorized() callback.
     * Called on every request matched by the middleware.
     * We do NOT hit the database here — that would be too slow and is not
     * available on the Edge.  The JWT already carries what we need.
     */
    authorized({ auth, request }) {
      const { nextUrl } = request;
      const isAuthenticated = !!auth?.user?.id;
      const isAuthRoute = nextUrl.pathname.startsWith('/login');
      const isChangePasswordRoute = nextUrl.pathname.startsWith('/change-password');
      const isApiAuthRoute = nextUrl.pathname.startsWith('/api/auth');
      const isPublicAsset =
        nextUrl.pathname.startsWith('/_next') ||
        nextUrl.pathname.startsWith('/brand') ||
        nextUrl.pathname === '/favicon.ico';

      if (isPublicAsset || isApiAuthRoute) return true;

      if (!isAuthenticated && !isAuthRoute) return false; // redirect to /login

      if (isAuthenticated && isAuthRoute) {
        return Response.redirect(new URL('/dashboard', nextUrl));
      }

      if (isAuthenticated && auth.user.forcePasswordChange && !isChangePasswordRoute) {
        return Response.redirect(new URL('/change-password', nextUrl));
      }

      return true;
    },

    jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id ?? '';
        token.roleId = (user as { roleId: string }).roleId;
        token.forcePasswordChange = (user as { forcePasswordChange: boolean }).forcePasswordChange;
      }
      return token;
    },

    session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.roleId = token.roleId as string;
        session.user.forcePasswordChange = token.forcePasswordChange as boolean;
      }
      return session;
    },
  },
};
