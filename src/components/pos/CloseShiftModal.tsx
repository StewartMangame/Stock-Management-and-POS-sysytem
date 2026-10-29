'use client';

import { useState, useEffect } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Coins, CreditCard, Loader2 } from 'lucide-react';
import { closeShiftAction } from '@/app/(app)/pos/actions';
import { parseKwachaToMinor, formatMwk } from '@/lib/money';
import { toast } from 'sonner';

interface CloseShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  shiftId: string;
  onShiftClosed: (shiftId: string) => void;
}

const DENOMINATIONS = [5000, 2000, 1000, 500, 200, 100, 50, 20];

export function CloseShiftModal({
  isOpen,
  onClose,
  shiftId,
  onShiftClosed,
}: CloseShiftModalProps) {
  const [method, setMethod] = useState<'total' | 'denominations'>('total');
  const [totalStr, setTotalStr] = useState('');
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [cardTotals, setCardTotals] = useState<Record<string, string>>({});
  const [terminals, setTerminals] = useState<any[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch terminals for card reconciliation
  useEffect(() => {
    if (isOpen) {
      fetch('/api/pos/terminals')
        .then((res) => res.json())
        .then((data) => {
          if (data.terminals) setTerminals(data.terminals);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  // Compute total from denomination counts (in minor units)
  const denominationTotalMinor = Object.entries(counts).reduce((sum, [denom, count]) => {
    return sum + Number(denom) * (Number(count) || 0) * 100;
  }, 0);

  const getCountedCashMinor = (): number => {
    if (method === 'denominations') {
      return denominationTotalMinor;
    }
    return parseKwachaToMinor(totalStr || '0');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let countedCashMinor: number;
    try {
      countedCashMinor = getCountedCashMinor();
      if (countedCashMinor < 0) throw new Error();
    } catch {
      setError('Please enter a valid non-negative cash amount.');
      return;
    }

    // Convert terminal totals to minor units
    const parsedTerminalTotals: Record<string, number> = {};
    for (const [tid, val] of Object.entries(cardTotals)) {
      if (val && parseFloat(val) > 0) {
        parsedTerminalTotals[tid] = parseKwachaToMinor(val);
      }
    }

    setLoading(true);
    try {
      const res = await closeShiftAction({
        shiftId,
        countedCashMinor,
        denominationCount: method === 'denominations' ? (counts as Record<string, number>) : undefined,
        cardTerminalTotals: parsedTerminalTotals,
        notes: notes.trim() || undefined,
      });

      toast.success('Shift closed successfully.');
      onClose();
      onShiftClosed(shiftId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to close shift');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-ace-navy">Close POS Shift</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Enter your final counted cash (blind count) and terminal totals to generate the Z-Report
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {error && (
            <div className="rounded-md bg-destructive/15 p-3 text-xs font-medium text-destructive">
              {error}
            </div>
          )}

          {/* Cash counting method */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Cash Count Entry</Label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setMethod('total')}
                className={`py-2 px-3 rounded-md font-semibold transition-all ${
                  method === 'total'
                    ? 'bg-ace-navy text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Lump Sum Total
              </button>
              <button
                type="button"
                onClick={() => setMethod('denominations')}
                className={`py-2 px-3 rounded-md font-semibold transition-all ${
                  method === 'denominations'
                    ? 'bg-ace-navy text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Count by Denomination
              </button>
            </div>
          </div>

          {method === 'total' ? (
            <div className="space-y-1.5 rounded-lg border border-border p-4 bg-card">
              <Label htmlFor="lump-sum-cash" className="text-xs font-semibold">
                Total Counted Cash in Drawer
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-xs font-bold text-muted-foreground">
                  MWK
                </span>
                <Input
                  id="lump-sum-cash"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  autoFocus
                  value={totalStr}
                  onChange={(e) => setTotalStr(e.target.value)}
                  className="pl-14 text-lg font-bold"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-border p-3 bg-card">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground pb-1 border-b">
                <span>Denomination</span>
                <span>Count (Pcs)</span>
                <span>Subtotal</span>
              </div>
              <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
                {DENOMINATIONS.map((denom) => {
                  const count = counts[denom] || 0;
                  const lineTotalMinor = denom * count * 100;
                  return (
                    <div key={denom} className="grid grid-cols-3 items-center gap-2 text-xs">
                      <span className="font-semibold text-ace-navy">MWK {denom}</span>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={counts[denom] || ''}
                        onChange={(e) =>
                          setCounts({
                            ...counts,
                            [denom]: Math.max(0, parseInt(e.target.value) || 0),
                          })
                        }
                        className="h-8 text-center text-xs"
                      />
                      <span className="text-right font-medium text-muted-foreground">
                        {formatMwk(lineTotalMinor)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between items-center pt-2 border-t font-bold text-sm text-foreground">
                <span>Total Counted:</span>
                <span className="text-ace-navy">{formatMwk(denominationTotalMinor)}</span>
              </div>
            </div>
          )}

          {/* Card terminal batch totals (if any configured) */}
          {terminals.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border p-3 bg-card">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ace-navy">
                <CreditCard className="h-4 w-4" />
                <span>Card Terminal Batch Settlement Totals</span>
              </div>
              <div className="space-y-2 pt-1">
                {terminals.map((t) => (
                  <div key={t.id} className="grid grid-cols-2 items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {t.name} ({t.terminalId})
                    </span>
                    <div className="relative">
                      <span className="absolute left-2.5 top-2 text-[10px] font-bold text-muted-foreground">
                        MWK
                      </span>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="0.00"
                        value={cardTotals[t.terminalId] || ''}
                        onChange={(e) =>
                          setCardTotals({ ...cardTotals, [t.terminalId]: e.target.value })
                        }
                        className="h-8 pl-11 text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="close-notes" className="text-xs font-semibold">
              Shift Closing Notes (Optional)
            </Label>
            <Textarea
              id="close-notes"
              placeholder="e.g. Discrepancy explanation or general handover notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-xs resize-none"
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
              disabled={loading}
              className="w-full bg-destructive hover:bg-destructive/90 text-white sm:w-auto font-semibold"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Closing Shift...
                </>
              ) : (
                'Confirm & Close Shift'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
