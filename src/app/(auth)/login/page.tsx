'use client';

import { useState, useTransition, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Lock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { loginSchema, type LoginInput } from '@/lib/validation';

/**
 * Maps NextAuth v5 error codes to user-friendly messages.
 *
 * NextAuth v5 SignInResponse carries two fields:
 *   result.error  - the AuthError type name (e.g. "CredentialsSignin", "CallbackRouteError")
 *   result.code   - the custom code set on a CredentialsSignin subclass (e.g. "RateLimitExceeded")
 *
 * Check `result.code` first (custom codes), then fall back to `result.error` (error type).
 */
const CODE_MESSAGES: Record<string, string> = {
  // Custom codes set on CredentialsSignin subclasses (result.code)
  RateLimitExceeded: 'Too many failed attempts. Please try again in 15 minutes.',
};

const ERROR_MESSAGES: Record<string, string> = {
  // Standard NextAuth v5 error types (result.error)
  CredentialsSignin: 'Incorrect email or password.',
  CallbackRouteError: 'Sign in failed due to a server error. Please try again later.',
  default: 'Sign in failed. Please try again.',
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams?.get('callbackUrl') ?? '/dashboard';
  const errorCode = searchParams?.get('error') ?? null;
  const urlCode = searchParams?.get('code') ?? null;

  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(
    // Handle error codes from redirect-based flows (e.g. middleware redirect to /login?error=...)
    urlCode
      ? (CODE_MESSAGES[urlCode] ?? ERROR_MESSAGES[errorCode ?? ''] ?? ERROR_MESSAGES['default'] ?? null)
      : errorCode
        ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES['default'] ?? null)
        : null,
  );

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = (data: LoginInput) => {
    setServerError(null);
    startTransition(async () => {
      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        // result.code carries the custom code set on CredentialsSignin subclasses.
        // Check it first; fall back to the error type name.
        const msg =
          (result.code ? CODE_MESSAGES[result.code] : undefined) ??
          ERROR_MESSAGES[result.error] ??
          ERROR_MESSAGES['default'] ??
          'Sign in failed.';

        if (process.env.NODE_ENV !== 'production') {
          // Surface the actual error type in dev so it is easy to debug.
          console.warn('[login] signIn error:', { error: result.error, code: result.code });
        }

        setServerError(msg);
        return;
      }

      // Success - let middleware handle redirect to /change-password if needed
      router.push(callbackUrl);
      router.refresh();
    });
  };

  return (
    <Card className="w-full max-w-md shadow-lg">
      {/* Ace-branded header band */}
      <div className="h-2 w-full rounded-t-lg bg-gradient-to-r from-ace-navy via-ace-blue to-ace-sky" />

      <CardHeader className="space-y-3 pb-6 pt-8">
        {/* Logo placeholder */}
        <div className="flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-ace-navy shadow-md">
            <span className="text-xl font-bold text-white">A</span>
          </div>
        </div>
        <div className="text-center">
          <CardTitle className="text-xl">ACE HOLDINGS LIMITED</CardTitle>
          <CardDescription className="mt-1">Sign in to the POS system</CardDescription>
        </div>
      </CardHeader>

      <CardContent className="pb-8">
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          aria-label="Sign in form"
        >
          {/* Error banner */}
          {serverError && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {serverError}
            </div>
          )}

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="login-email">Email address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ace-muted" />
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="you@ace.co.mw"
                className="pl-9"
                aria-invalid={!!form.formState.errors.email}
                {...form.register('email')}
              />
            </div>
            {form.formState.errors.email && (
              <p className="text-xs text-red-600">{form.formState.errors.email.message}</p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <Label htmlFor="login-password">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ace-muted" />
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                className="pl-9"
                aria-invalid={!!form.formState.errors.password}
                {...form.register('password')}
              />
            </div>
            {form.formState.errors.password && (
              <p className="text-xs text-red-600">{form.formState.errors.password.message}</p>
            )}
          </div>

          <Button
            id="login-submit"
            type="submit"
            className="w-full"
            size="lg"
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-ace-muted">
          Ace Holdings Limited · Blantyre, Malawi
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <Card className="w-full max-w-md shadow-lg p-12 flex justify-center items-center">
          <Loader2 className="h-8 w-8 animate-spin text-ace-navy" />
        </Card>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
