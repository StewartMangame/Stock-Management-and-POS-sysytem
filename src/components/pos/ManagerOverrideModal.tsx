'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldAlert, KeyRound, Loader2 } from 'lucide-react';
import { verifyManagerOverrideAction } from '@/app/(app)/pos/actions';

interface ManagerOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  action: string;
  actionLabel?: string;
  defaultReason?: string;
  onSuccess: (approverId: string, pin: string, reason: string) => void;
}

export function ManagerOverrideModal({
  isOpen,
  onClose,
  action,
  actionLabel,
  defaultReason = '',
  onSuccess,
}: ManagerOverrideModalProps) {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState(defaultReason);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setError('Manager PIN must be exactly 6 digits.');
      return;
    }

    if (!reason.trim()) {
      setError('Please provide a reason for the override.');
      return;
    }

    setLoading(true);
    try {
      const res = await verifyManagerOverrideAction({
        pin,
        action,
        reason: reason.trim(),
      });

      onSuccess(res.approverId, pin, reason.trim());
      setPin('');
      setReason('');
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Override verification failed.');
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-ace-navy">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ace-band text-ace-navy">
              <ShieldAlert className="h-5 w-5 text-ace-blue" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">Manager Override Required</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {actionLabel || action}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {error && (
            <div className="rounded-md bg-destructive/15 p-3 text-xs font-medium text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="override-pin" className="text-xs font-semibold">
              6-Digit Manager PIN
            </Label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="override-pin"
                type="password"
                maxLength={6}
                autoFocus
                placeholder="••••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="pl-9 tracking-widest text-center text-lg font-mono font-bold"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="override-reason" className="text-xs font-semibold">
              Reason for Override
            </Label>
            <Input
              id="override-reason"
              placeholder="e.g. Customer loyalty discount / Damaged box"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="text-sm"
            />
          </div>

          <DialogFooter className="pt-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || pin.length !== 6 || !reason.trim()}
              className="w-full bg-ace-navy hover:bg-ace-navy-deep text-white sm:w-auto"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Authorize Override'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
