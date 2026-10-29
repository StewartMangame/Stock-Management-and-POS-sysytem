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
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Banknote,
  CreditCard,
  Smartphone,
  Plus,
  Trash2,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { formatMwk, parseKwachaToMinor } from '@/lib/money';
import { toast } from 'sonner';

export interface PaymentLeg {
  id: string;
  method: 'cash' | 'card' | 'airtel_money' | 'mpamba' | 'bank_transfer';
  appliedMinor: number;
  tenderedMinor?: number;
  details?: Record<string, unknown>;
}

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalMinor: number;
  onCompleteSale: (payments: PaymentLeg[], changeMinor: number) => Promise<void>;
}

export function PaymentModal({
  isOpen,
  onClose,
  totalMinor,
  onCompleteSale,
}: PaymentModalProps) {
  const [payments, setPayments] = useState<PaymentLeg[]>([]);
  const [currentMethod, setCurrentMethod] = useState<'cash' | 'card' | 'airtel_money' | 'mpamba'>('cash');
  const [currentAmountStr, setCurrentAmountStr] = useState('');
  const [cashTenderedStr, setCashTenderedStr] = useState('');

  // Card details
  const [terminals, setTerminals] = useState<any[]>([]);
  const [selectedTerminalId, setSelectedTerminalId] = useState('');
  const [cardSlipNumber, setCardSlipNumber] = useState('');
  const [cardApprovalCode, setCardApprovalCode] = useState('');

  // Mobile money details
  const [mobilePhone, setMobilePhone] = useState('');
  const [mobileTxId, setMobileTxId] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize with single full cash payment when modal opens
  useEffect(() => {
    if (isOpen) {
      setPayments([]);
      setCurrentMethod('cash');
      const fullKwacha = (totalMinor / 100).toFixed(2);
      setCurrentAmountStr(fullKwacha);
      setCashTenderedStr(fullKwacha);
      setError(null);

      // Fetch card terminals
      fetch('/api/pos/terminals')
        .then((res) => res.json())
        .then((data) => {
          if (data.terminals) {
            setTerminals(data.terminals);
            if (data.terminals[0]) setSelectedTerminalId(data.terminals[0].terminalId);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, totalMinor]);

  const totalAppliedMinor = payments.reduce((sum, p) => sum + p.appliedMinor, 0);
  const remainingMinor = Math.max(0, totalMinor - totalAppliedMinor);

  // For cash payments, calculate change
  const cashLeg = payments.find((p) => p.method === 'cash');
  const cashChangeMinor = cashLeg && cashLeg.tenderedMinor
    ? Math.max(0, cashLeg.tenderedMinor - cashLeg.appliedMinor)
    : 0;

  // Add payment leg to split list
  const handleAddPaymentLeg = () => {
    setError(null);
    let appliedMinor: number;
    try {
      appliedMinor = parseKwachaToMinor(currentAmountStr);
      if (appliedMinor <= 0) throw new Error();
    } catch {
      setError('Please enter a valid payment amount.');
      return;
    }

    if (appliedMinor > remainingMinor) {
      setError(`Amount cannot exceed remaining balance of ${formatMwk(remainingMinor)}.`);
      return;
    }

    let tenderedMinor: number | undefined;
    let details: Record<string, unknown> = {};

    if (currentMethod === 'cash') {
      const tendered = cashTenderedStr ? parseKwachaToMinor(cashTenderedStr) : appliedMinor;
      if (tendered < appliedMinor) {
        setError('Cash tendered cannot be less than applied amount.');
        return;
      }
      tenderedMinor = tendered;
      details = {
        tendered_minor: tendered,
        change_minor: tendered - appliedMinor,
      };
    } else if (currentMethod === 'card') {
      if (!cardSlipNumber.trim() || !cardApprovalCode.trim()) {
        setError('Card slip number and approval code are required.');
        return;
      }
      details = {
        terminal_id: selectedTerminalId,
        slip_number: cardSlipNumber.trim(),
        approval_code: cardApprovalCode.trim(),
      };
    } else if (currentMethod === 'airtel_money' || currentMethod === 'mpamba') {
      if (!mobileTxId.trim() || !mobilePhone.trim()) {
        setError('Mobile money transaction ID and customer phone are required.');
        return;
      }
      details = {
        transaction_id: mobileTxId.trim(),
        sender_phone: mobilePhone.trim(),
        provider: currentMethod,
      };
    }

    const newLeg: PaymentLeg = {
      id: Math.random().toString(),
      method: currentMethod,
      appliedMinor,
      tenderedMinor,
      details,
    };

    const newPayments = [...payments, newLeg];
    setPayments(newPayments);

    // Reset current form for next split leg
    const newRemaining = totalMinor - newPayments.reduce((s, p) => s + p.appliedMinor, 0);
    const nextAmount = (newRemaining / 100).toFixed(2);
    setCurrentAmountStr(nextAmount);
    setCashTenderedStr(nextAmount);
    setCardSlipNumber('');
    setCardApprovalCode('');
    setMobileTxId('');
    setMobilePhone('');
  };

  const handleRemovePaymentLeg = (id: string) => {
    const updated = payments.filter((p) => p.id !== id);
    setPayments(updated);
    const newRemaining = totalMinor - updated.reduce((s, p) => s + p.appliedMinor, 0);
    setCurrentAmountStr((newRemaining / 100).toFixed(2));
    setCashTenderedStr((newRemaining / 100).toFixed(2));
  };

  // Quick cash denomination helper
  const handleQuickCash = (amountKwacha: number) => {
    const val = (amountKwacha).toFixed(2);
    setCashTenderedStr(val);
  };

  const handleCompleteSale = async () => {
    if (remainingMinor > 0) {
      setError(`Cannot complete sale. Balance of ${formatMwk(remainingMinor)} is unpaid.`);
      return;
    }

    setLoading(true);
    try {
      await onCompleteSale(payments, cashChangeMinor);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to complete sale');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl font-bold text-ace-navy">Tender Payment</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Select tender method(s) and complete transaction
              </DialogDescription>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">
                Grand Total
              </span>
              <div className="text-2xl font-black text-ace-navy">{formatMwk(totalMinor)}</div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/15 p-3 text-xs font-medium text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Payment Split Legs Summary */}
          {payments.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex justify-between items-center text-xs font-semibold text-muted-foreground">
                <span>Applied Tenders ({payments.length})</span>
                <span>Applied / Tendered</span>
              </div>
              <div className="space-y-1.5">
                {payments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <Badge variant="outline" className="capitalize text-[10px]">
                        {p.method.replace('_', ' ')}
                      </Badge>
                      <span>{formatMwk(p.appliedMinor)}</span>
                      {p.tenderedMinor && p.tenderedMinor > p.appliedMinor && (
                        <span className="text-muted-foreground text-[10px]">
                          (Tendered: {formatMwk(p.tenderedMinor)})
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemovePaymentLeg(p.id)}
                      className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Balance Tracker */}
          <div className="flex items-center justify-between rounded-lg bg-ace-band/40 border border-ace-band p-3">
            <span className="text-xs font-semibold text-ace-navy">Remaining Balance:</span>
            <span
              className={`text-lg font-bold ${
                remainingMinor === 0 ? 'text-ace-success' : 'text-destructive'
              }`}
            >
              {remainingMinor === 0 ? 'Paid in Full' : formatMwk(remainingMinor)}
            </span>
          </div>

          {/* Tender Input Form (enabled if balance remaining) */}
          {remainingMinor > 0 && (
            <div className="rounded-lg border border-border p-4 space-y-3.5 bg-card">
              <Label className="text-xs font-semibold text-foreground">Select Tender Method</Label>
              {/* Method Switcher */}
              <div className="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentMethod('cash')}
                  className={`flex flex-col items-center justify-center gap-1 py-2.5 px-2 rounded-lg border text-xs font-semibold transition-all ${
                    currentMethod === 'cash'
                      ? 'border-ace-navy bg-ace-navy text-white shadow-sm'
                      : 'border-border bg-background hover:bg-muted text-foreground'
                  }`}
                >
                  <Banknote className="h-4 w-4" />
                  Cash
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentMethod('card')}
                  className={`flex flex-col items-center justify-center gap-1 py-2.5 px-2 rounded-lg border text-xs font-semibold transition-all ${
                    currentMethod === 'card'
                      ? 'border-ace-navy bg-ace-navy text-white shadow-sm'
                      : 'border-border bg-background hover:bg-muted text-foreground'
                  }`}
                >
                  <CreditCard className="h-4 w-4" />
                  Card POS
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentMethod('airtel_money')}
                  className={`flex flex-col items-center justify-center gap-1 py-2.5 px-2 rounded-lg border text-xs font-semibold transition-all ${
                    currentMethod === 'airtel_money'
                      ? 'border-red-600 bg-red-600 text-white shadow-sm'
                      : 'border-border bg-background hover:bg-muted text-foreground'
                  }`}
                >
                  <Smartphone className="h-4 w-4" />
                  Airtel Money
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentMethod('mpamba')}
                  className={`flex flex-col items-center justify-center gap-1 py-2.5 px-2 rounded-lg border text-xs font-semibold transition-all ${
                    currentMethod === 'mpamba'
                      ? 'border-green-600 bg-green-600 text-white shadow-sm'
                      : 'border-border bg-background hover:bg-muted text-foreground'
                  }`}
                >
                  <Smartphone className="h-4 w-4" />
                  TNM Mpamba
                </button>
              </div>

              {/* Amount Inputs */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label htmlFor="tender-amount" className="text-xs font-semibold">
                    Applied Amount (MWK)
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs font-bold text-muted-foreground">
                      MWK
                    </span>
                    <Input
                      id="tender-amount"
                      type="number"
                      step="any"
                      min="0"
                      value={currentAmountStr}
                      onChange={(e) => setCurrentAmountStr(e.target.value)}
                      className="pl-14 text-base font-semibold"
                    />
                  </div>
                </div>

                {currentMethod === 'cash' ? (
                  <div className="space-y-1">
                    <Label htmlFor="cash-tendered" className="text-xs font-semibold">
                      Cash Tendered (From Customer)
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-xs font-bold text-muted-foreground">
                        MWK
                      </span>
                      <Input
                        id="cash-tendered"
                        type="number"
                        step="any"
                        min="0"
                        value={cashTenderedStr}
                        onChange={(e) => setCashTenderedStr(e.target.value)}
                        className="pl-14 text-base font-semibold"
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Quick Cash Buttons (for cash only) */}
              {currentMethod === 'cash' && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Quick Cash:</span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleQuickCash(remainingMinor / 100)}
                      className="h-7 text-xs font-semibold border-ace-navy/30"
                    >
                      Exact ({formatMwk(remainingMinor)})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleQuickCash(Math.ceil(remainingMinor / 100 / 1000) * 1000 || 1000)
                      }
                      className="h-7 text-xs font-semibold"
                    >
                      +Next 1,000
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleQuickCash(Math.ceil(remainingMinor / 100 / 2000) * 2000 || 2000)
                      }
                      className="h-7 text-xs font-semibold"
                    >
                      +Next 2,000
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleQuickCash(Math.ceil(remainingMinor / 100 / 5000) * 5000 || 5000)
                      }
                      className="h-7 text-xs font-semibold"
                    >
                      +Next 5,000
                    </Button>
                  </div>
                </div>
              )}

              {/* Card Terminal Inputs */}
              {currentMethod === 'card' && (
                <div className="grid grid-cols-3 gap-2.5 pt-1">
                  <div className="space-y-1">
                    <Label className="text-xs">Card Terminal</Label>
                    <Select value={selectedTerminalId} onValueChange={setSelectedTerminalId}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Select terminal" />
                      </SelectTrigger>
                      <SelectContent>
                        {terminals.map((t) => (
                          <SelectItem key={t.id} value={t.terminalId} className="text-xs">
                            {t.name} ({t.terminalId})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="card-slip" className="text-xs">
                      Slip / Trace #
                    </Label>
                    <Input
                      id="card-slip"
                      placeholder="e.g. 001248"
                      value={cardSlipNumber}
                      onChange={(e) => setCardSlipNumber(e.target.value)}
                      className="h-9 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="card-auth" className="text-xs">
                      Approval Code
                    </Label>
                    <Input
                      id="card-auth"
                      placeholder="e.g. APP842"
                      value={cardApprovalCode}
                      onChange={(e) => setCardApprovalCode(e.target.value)}
                      className="h-9 text-xs"
                    />
                  </div>
                </div>
              )}

              {/* Mobile Money Inputs */}
              {(currentMethod === 'airtel_money' || currentMethod === 'mpamba') && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <Label htmlFor="mobile-txid" className="text-xs">
                      Transaction ID / Reference
                    </Label>
                    <Input
                      id="mobile-txid"
                      placeholder="e.g. CI241029.1234.H00123"
                      value={mobileTxId}
                      onChange={(e) => setMobileTxId(e.target.value)}
                      className="h-9 text-xs uppercase font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="mobile-phone" className="text-xs">
                      Customer Phone Number
                    </Label>
                    <Input
                      id="mobile-phone"
                      placeholder="e.g. 0991234567"
                      value={mobilePhone}
                      onChange={(e) => setMobilePhone(e.target.value)}
                      className="h-9 text-xs"
                    />
                  </div>
                </div>
              )}

              <Button
                type="button"
                onClick={handleAddPaymentLeg}
                className="w-full bg-ace-blue hover:bg-ace-navy text-white text-xs font-semibold h-9"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Payment Leg
              </Button>
            </div>
          )}

          {/* Change Indicator */}
          {cashChangeMinor > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 p-3.5 text-emerald-900">
              <span className="text-xs font-bold uppercase tracking-wider">Change Due to Customer:</span>
              <span className="text-xl font-black text-emerald-700">{formatMwk(cashChangeMinor)}</span>
            </div>
          )}
        </div>

        <DialogFooter className="pt-2 sm:justify-between border-t border-border">
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
            type="button"
            disabled={loading || remainingMinor > 0}
            onClick={handleCompleteSale}
            className="w-full bg-ace-success hover:bg-emerald-700 text-white font-bold sm:w-auto px-6 h-11 text-sm shadow-md"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing Sale...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Complete Sale (Enter)
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
