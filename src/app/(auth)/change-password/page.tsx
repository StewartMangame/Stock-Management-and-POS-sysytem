'use client';

import { useActionState, useEffect } from 'react';
import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { changePasswordAction } from './actions';

const initialState = { error: undefined, success: false };

export default function ChangePasswordPage() {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(changePasswordAction, initialState);

  useEffect(() => {
    if (state.success) {
      toast.success('Password changed! Please sign in with your new password.');
      // Sign out so the old JWT (with forcePasswordChange=true) is cleared,
      // then send to login. The user re-authenticates with their new password.
      signOut({ callbackUrl: '/login' });
    }
  }, [state.success, router]);


  return (
    <Card className="w-full max-w-md shadow-lg">
      <div className="h-2 w-full rounded-t-lg bg-gradient-to-r from-ace-navy via-ace-blue to-ace-sky" />

      <CardHeader className="pb-6 pt-8">
        <div className="mb-2 flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ace-band">
            <ShieldCheck className="h-6 w-6 text-ace-blue" />
          </div>
        </div>
        <CardTitle className="text-center text-xl">Set a new password</CardTitle>
        <CardDescription className="text-center">
          Your account requires a password change before you can continue.
        </CardDescription>
      </CardHeader>

      <CardContent className="pb-8">
        <form action={formAction} className="space-y-4" aria-label="Change password form">
          {state.error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {state.error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">Current password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ace-muted" />
              <Input id="currentPassword" name="currentPassword" type="password" className="pl-9" autoComplete="current-password" required />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ace-muted" />
              <Input id="newPassword" name="newPassword" type="password" className="pl-9" autoComplete="new-password" required />
            </div>
            <p className="text-xs text-ace-muted">At least 8 characters, one uppercase letter, one number.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ace-muted" />
              <Input id="confirmPassword" name="confirmPassword" type="password" className="pl-9" autoComplete="new-password" required />
            </div>
          </div>

          <Button id="change-password-submit" type="submit" className="w-full" size="lg" disabled={isPending}>
            {isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
            ) : (
              'Set new password'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
