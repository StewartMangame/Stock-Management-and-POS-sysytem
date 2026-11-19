/**
 * Tests for NextAuth v5 sign-in error propagation.
 *
 * Verifies that:
 *  1. RateLimitError is a CredentialsSignin subclass (survives callback route)
 *  2. RateLimitError carries code = 'RateLimitExceeded'
 *  3. The login page message resolution picks `result.code` before `result.error`
 *  4. No user-facing message contains SQL text, stack traces, or internal identifiers
 *  5. The NextAuth v5 error propagation contract is documented and tested
 *
 * NOTE: We mock 'next-auth' to avoid requiring a Next.js runtime environment.
 * The contract between RateLimitError and the callback route is separately
 * verified by reading the @auth/core source (see comment in test body).
 */

import { describe, it, expect, vi } from 'vitest';

// ── Mock next-auth before any imports that transitively require it ─────────────
vi.mock('next-auth', () => {
  /**
   * Minimal CredentialsSignin stub that mirrors the real class contract:
   * - extends Error
   * - has a `type` property = "CredentialsSignin"
   * - has a settable `code` property (default "credentials")
   */
  class AuthError extends Error {
    type: string;
    constructor(message?: string) {
      super(message);
      this.name = 'AuthError';
      this.type = 'AuthError';
    }
  }

  class CredentialsSignin extends AuthError {
    code: string = 'credentials';
    constructor(message?: string) {
      super(message);
      this.name = 'CredentialsSignin';
      this.type = 'CredentialsSignin';
    }
  }

  return {
    default: vi.fn(() => ({
      handlers: {},
      auth: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
      unstable_update: vi.fn(),
    })),
    CredentialsSignin,
    AuthError,
  };
});

vi.mock('@/auth.config', () => ({
  authConfig: {
    trustHost: true,
    secret: 'test-secret',
    session: { strategy: 'jwt', maxAge: 43200 },
    cookies: { sessionToken: { name: 'ace.test.session-token', options: {} } },
    pages: { signIn: '/login', error: '/login' },
    providers: [],
    callbacks: {
      jwt: ({ token, user }: { token: Record<string, unknown>; user?: Record<string, unknown> }) => {
        if (user) {
          token.id = user.id ?? '';
          token.roleId = (user as { roleId: string }).roleId;
          token.forcePasswordChange = (user as { forcePasswordChange: boolean }).forcePasswordChange;
        }
        return token;
      },
      session: ({ session }: { session: Record<string, unknown> }) => session,
      authorized: () => true,
    },
  },
}));

vi.mock('@/server/db', () => ({
  db: {
    query: { users: { findFirst: vi.fn() } },
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
  },
}));

vi.mock('@/server/services/rate-limit', () => ({
  checkLoginRateLimit: vi.fn(),
  recordLoginAttempt: vi.fn(),
}));

vi.mock('@node-rs/argon2', () => ({
  verify: vi.fn(),
}));

vi.mock('@/lib/validation', () => ({
  loginSchema: {
    safeParse: (data: unknown) => ({ success: true, data }),
  },
}));

// ── Now safe to import @/auth ─────────────────────────────────────────────────
import { RateLimitError } from '@/auth';
import { CredentialsSignin } from 'next-auth';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RateLimitError class', () => {
  it('is a subclass of CredentialsSignin', () => {
    const err = new RateLimitError();
    expect(err).toBeInstanceOf(CredentialsSignin);
  });

  it('is an instance of Error', () => {
    const err = new RateLimitError();
    expect(err).toBeInstanceOf(Error);
  });

  it('has code = "RateLimitExceeded"', () => {
    const err = new RateLimitError();
    expect(err.code).toBe('RateLimitExceeded');
  });

  it('has the correct type name for NextAuth v5 routing', () => {
    // CredentialsSignin.type = "CredentialsSignin" - this is what NextAuth v5
    // puts in the redirect URL ?error= parameter.
    // The custom code goes into ?code= parameter.
    const err = new RateLimitError();
    expect((err as unknown as { type: string }).type).toBe('CredentialsSignin');
  });

  it('NextAuth v5 SignInResponse contract: error=CredentialsSignin, code=RateLimitExceeded', () => {
    // When RateLimitError is thrown in authorize(), the client-side signIn()
    // result will be:
    //   result.error = "CredentialsSignin"   (the AuthError type, from ?error= URL param)
    //   result.code  = "RateLimitExceeded"   (CredentialsSignin.code, from ?code= URL param)
    //
    // The login page MUST check result.code for custom codes, then result.error
    // for the generic type.
    const err = new RateLimitError();
    const signInResponse = {
      error: (err as unknown as { type: string }).type,
      code: err.code,
    };
    expect(signInResponse.error).toBe('CredentialsSignin');
    expect(signInResponse.code).toBe('RateLimitExceeded');
  });
});

describe('NextAuth v5 error propagation contract', () => {
  it('a plain Error is NOT a CredentialsSignin and would become CallbackRouteError', () => {
    // This documents the BUG that was fixed by using RateLimitError extends CredentialsSignin.
    //
    // From @auth/core/lib/actions/callback/index.js:
    //   catch (e) {
    //     if (e instanceof AuthError) throw e;  // CredentialsSignin passes through
    //     const error = new CallbackRouteError(e, ...); // plain Error is wrapped
    //     throw error;
    //   }
    //
    // Result on client:
    //   - new Error('RateLimitExceeded') -> result.error = "CallbackRouteError" (BUG)
    //   - new RateLimitError()           -> result.error = "CredentialsSignin",
    //                                       result.code  = "RateLimitExceeded" (CORRECT)
    expect(new Error('RateLimitExceeded') instanceof CredentialsSignin).toBe(false);
    expect(new RateLimitError() instanceof CredentialsSignin).toBe(true);
  });
});

describe('Login page error message resolution', () => {
  // Mirror the exact logic from src/app/(auth)/login/page.tsx

  const CODE_MESSAGES: Record<string, string> = {
    RateLimitExceeded: 'Too many failed attempts. Please try again in 15 minutes.',
  };

  const ERROR_MESSAGES: Record<string, string> = {
    CredentialsSignin: 'Incorrect email or password.',
    CallbackRouteError: 'Sign in failed due to a server error. Please try again later.',
    default: 'Sign in failed. Please try again.',
  };

  function resolveMessage(error: string | undefined, code: string | undefined): string {
    return (
      (code ? CODE_MESSAGES[code] : undefined) ??
      ERROR_MESSAGES[error ?? ''] ??
      ERROR_MESSAGES['default'] ??
      'Sign in failed.'
    );
  }

  it('rate limit: code=RateLimitExceeded takes priority over error=CredentialsSignin', () => {
    expect(resolveMessage('CredentialsSignin', 'RateLimitExceeded')).toBe(
      'Too many failed attempts. Please try again in 15 minutes.',
    );
  });

  it('wrong credentials: error=CredentialsSignin, code=credentials -> wrong password message', () => {
    expect(resolveMessage('CredentialsSignin', 'credentials')).toBe(
      'Incorrect email or password.',
    );
  });

  it('server error: error=CallbackRouteError -> server error message', () => {
    expect(resolveMessage('CallbackRouteError', undefined)).toBe(
      'Sign in failed due to a server error. Please try again later.',
    );
  });

  it('unknown error type falls back to default message', () => {
    expect(resolveMessage('SomeUnknownError', undefined)).toBe('Sign in failed. Please try again.');
  });

  it('no error (should not be called, but returns default safely)', () => {
    expect(resolveMessage(undefined, undefined)).toBe('Sign in failed. Please try again.');
  });

  it('CODE_MESSAGES covers RateLimitExceeded', () => {
    expect(CODE_MESSAGES['RateLimitExceeded']).toBeDefined();
  });

  it('ERROR_MESSAGES covers CredentialsSignin and CallbackRouteError', () => {
    expect(ERROR_MESSAGES['CredentialsSignin']).toBeDefined();
    expect(ERROR_MESSAGES['CallbackRouteError']).toBeDefined();
    expect(ERROR_MESSAGES['default']).toBeDefined();
  });

  it('no user-facing message contains SQL text, stack traces, or internal identifiers', () => {
    const allMessages = Object.values(CODE_MESSAGES).concat(Object.values(ERROR_MESSAGES));
    const forbidden = [
      /\bselect\b/i,
      /\binsert\b/i,
      /\bupdate\b/i,
      /\bdelete\b/i,
      /\bpostgres\b/i,
      /\bneon\b/i,
      /\bdrizzle\b/i,
      /\bError:/,
      /at\s+\w+\s+\(/,  // stack trace line
      /\bsql\b/i,
      /\bconstraint\b/i,
      /\bviolat\b/i,
      /\bparameter\b/i,
    ];
    for (const msg of allMessages) {
      for (const pattern of forbidden) {
        expect(msg, `Message "${msg}" contains forbidden pattern ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
