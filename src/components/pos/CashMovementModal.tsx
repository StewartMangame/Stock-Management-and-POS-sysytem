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
import { ArrowDownLeft, ArrowUpRight, KeyRound, Loader2 } from 'lucide-react';
import { recordCashMovementAction } from '@/app/(app)/pos/actions';
import { parseKwachaToMinor, formatMwk } from '@/lib/money';
import { toast } from 'sonner';

interface CashMovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  shiftId: string;
  onSuccess?: () => void;
}

export function CashMovementModal({
  isOpen,
  onClose,
  shiftId,
  onSuccess,
}: CashMovementModalProps) {
  const [kind, setKind] = useState<'paid_in' | 'paid_out'>('paid_in');
  const [amountStr, setAmountStr] = useState('');
  const [reason, setReason] = useState('');
  const [overridePin, setOverridePin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let amountMinor: number;
    try {
      amountMinor = parseKwachaToMinor(amountStr);
      if (amountMinor <= 0) throw new Error();
    } catch {
      setError('Please enter a valid positive amount.');
      return;
    }

    if (!reason.trim()) {
      setError('Please provide a reason for the cash movement.');
      return;
    }

    if (kind === 'paid_out' && (!overridePin || overridePin.length !== 6)) {
      setError('A 6-digit manager PIN is required for Cash Paid Out.');
      return;
    }

    setLoading(true);
    try {
      await recordCashMovementAction({
        shiftId,
        kind,
        amountMinor,
        reason: reason.trim(),
        overridePin: kind === 'paid_out' ? overridePin : undefined,
      });

      toast.success(
        `${kind === 'paid_in' ? 'Cash Paid In' : 'Cash Paid Out'} of ${formatMwk(amountMinor)} recorded.`,
      );
      setAmountStr('');
      setReason('');
      setOverridePin('');
      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to record cash movement');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-ace-navy">Cash Movement</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Record cash paid into or taken out of the till drawer
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {error && (
            <div className="rounded-md bg-destructive/15 p-3 text-xs font-medium text-destructive">
              {error}
            </div>
          )}

          {/* Type Toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-lg">
            <button
              type="button"
              onClick={() => setKind('paid_in')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold transition-all ${
                kind === 'paid_in'
                  ? 'bg-ace-success text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ArrowDownLeft className="h-4 w-4" />
              Cash In (Float / Top-up)
            </button>
            <button
              type="button"
              onClick={() => setKind('paid_out')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold transition-all ${
                kind === 'paid_out'
                  ? 'bg-destructive text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ArrowUpRight className="h-4 w-4" />
              Cash Out (Expense / Drop)
            </button>
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="movement-amount" className="text-xs font-semibold">
              Amount (MWK)
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs font-bold text-muted-foreground">
                MWK
              </span>
              <Input
                id="movement-amount"
                type="number"
                step="any"
                min="0"
                placeholder="0.00"
                autoFocus
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="pl-14 text-base font-semibold"
              />
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <Label htmlFor="movement-reason" className="text-xs font-semibold">
              Reason
            </Label>
            <Input
              id="movement-reason"
              placeholder={
                kind === 'paid_in'
                  ? 'e.g. Additional small-note float'
                  : 'e.g. Petty cash office supplies / Bank drop'
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="text-sm"
            />
          </div>

          {/* Manager PIN for Paid Out */}
          {kind === 'paid_out' && (
            <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="movement-pin" className="text-xs font-semibold text-amber-900">
                  Manager Authorization PIN
                </Label>
                <span className="text-[10px] text-amber-700">Required for cash-out</span>
              </div>
              <div className="relative">
                <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-amber-600" />
                <Input
                  id="movement-pin"
                  type="password"
                  maxLength={6}
                  placeholder="••••••"
                  value={overridePin}
                  onChange={(e) => setOverridePin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="pl-9 tracking-widest text-center font-mono font-bold bg-white"
                />
              </div>
            </div>
          )}

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
              disabled={loading || !amountStr || !reason.trim()}
              className="w-full bg-ace-navy hover:bg-ace-navy-deep text-white sm:w-auto font-semibold"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Recording...
                </>
              ) : (
                'Save Movement'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
