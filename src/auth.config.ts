/**
 * Edge-safe Auth.js configuration.
 *
 * This file MUST NOT import any Node.js-only modules (argon2, ws, pg, etc.)
 * because it is also used by Next.js middleware, which runs on the Edge runtime.
 *
 * The Credentials provider with argon2 verification lives in auth.ts only.
 */
import type { NextAuthConfig } from 'next-auth';

const appEnv = (process.env.APP_ENV || 'local').toLowerCase();
const isProd = appEnv === 'production';
const isStaging = appEnv === 'staging';
const useSecureCookies = isProd || isStaging;

// Environment-differentiated session cookie name
const cookiePrefix = useSecureCookies ? '__Secure-' : '';
const sessionCookieName = `${cookiePrefix}ace.${appEnv}.session-token`;

export const authConfig: NextAuthConfig = {
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 12 * 60 * 60, // 12 hours max session age
  },
  cookies: {
    sessionToken: {
      name: sessionCookieName,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
      },
    },
  },

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

      // 1. Health check endpoints (liveness and secret-protected DB check)
      const isHealthRoute = nextUrl.pathname === '/api/health' || nextUrl.pathname.startsWith('/api/health/');

      // 2. Cron jobs (protected by Bearer CRON_SECRET inside the route handler)
      const isCronRoute = nextUrl.pathname.startsWith('/api/cron/');

      // 3. Inbound webhooks (protected by cryptographic provider signatures inside route handler)
      const isWebhookRoute = nextUrl.pathname.startsWith('/api/webhooks/');

      // 4. Public customer payment portal & payment link APIs
      const isPublicPayRoute = nextUrl.pathname.startsWith('/pay/');
      const isPublicPayApi = nextUrl.pathname.startsWith('/api/pay/');

      if (
        isPublicAsset ||
        isHealthRoute ||
        isCronRoute ||
        isWebhookRoute ||
        isPublicPayRoute ||
        isPublicPayApi ||
        isApiAuthRoute
      ) {
        return true;
      }

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
      if (session.user) {
        session.user.id = token.id as string;
        session.user.roleId = token.roleId as string;
        session.user.forcePasswordChange = token.forcePasswordChange as boolean;
      }
      return session;
    },
  },
};
