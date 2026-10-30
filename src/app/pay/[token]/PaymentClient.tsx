'use client';

/**
 * PaymentClient — interactive mobile money payment form for public payment links.
 * Handles phone input, network detection, initiation, and status polling.
 */
import { useState, useCallback, useEffect, useRef } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface InvoiceSummary {
  id: string;
  documentNumber: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  customerName: string;
  lines: {
    id: string;
    description: string | null;
    quantity: string;
    unitPriceMinor: number;
    lineTotalMinor: number;
  }[];
}

export interface LinkData {
  valid: true;
  isPaid: false;
  linkId: string;
  allowPartial: boolean;
  expiresAt: string;
  invoice: InvoiceSummary;
}

interface Props {
  token: string;
  linkData: LinkData;
}

type Step = 'form' | 'processing' | 'success' | 'failed';

function formatMWK(amountMinor: number) {
  return `MWK ${(amountMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function detectNetwork(phone: string): 'airtel' | 'mpamba' | null {
  // Normalize: strip +265 or leading 0
  const digits = phone.replace(/^\+265/, '').replace(/^0/, '').replace(/\s+/g, '');
  if (digits.length !== 9) return null;
  if (digits.startsWith('8')) return 'airtel'; // Airtel Money: 08xxxxxxx
  if (digits.startsWith('9')) return 'mpamba'; // TNM Mpamba: 09xxxxxxx
  return null;
}

// ── Component ────────────────────────────────────────────────────────────────

export function PaymentClient({ token, linkData }: Props) {
  const { invoice, allowPartial } = linkData;

  const [phone, setPhone] = useState('');
  const [network, setNetwork] = useState<'airtel' | 'mpamba' | null>(null);
  const [amountMinor, setAmountMinor] = useState(invoice.balanceMinor);
  const [step, setStep] = useState<Step>('form');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Detect network as user types
  useEffect(() => {
    setNetwork(detectNetwork(phone));
  }, [phone]);

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startPolling = useCallback(
    (pid: string) => {
      let attempts = 0;
      const MAX_ATTEMPTS = 60; // 2 minutes at 2s intervals

      pollRef.current = setInterval(async () => {
        attempts++;
        if (attempts > MAX_ATTEMPTS) {
          clearInterval(pollRef.current!);
          setStep('failed');
          setErrorMsg('Payment timed out. Please check with your network provider and contact support if funds were deducted.');
          return;
        }

        try {
          const res = await fetch(`/api/pay/${token}/status?paymentId=${pid}`);
          const data = await res.json();

          if (data.status === 'confirmed') {
            clearInterval(pollRef.current!);
            setStep('success');
          } else if (data.status === 'failed' || data.status === 'reversed') {
            clearInterval(pollRef.current!);
            setStep('failed');
            setErrorMsg(data.error ?? 'Payment failed. Please try again.');
          }
          // pending / processing → keep polling
        } catch {
          // network hiccup — keep polling
        }
      }, 2000);
    },
    [token],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/pay/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, amountMinor }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error ?? 'Failed to initiate payment.');
        setSubmitting(false);
        return;
      }

      setPaymentId(data.paymentId);
      setStep('processing');
      startPolling(data.paymentId);
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.');
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-md w-full bg-background rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-primary px-6 py-5 text-primary-foreground">
        <p className="text-sm font-medium opacity-80">Invoice Payment</p>
        <p className="text-2xl font-bold font-mono mt-1">{invoice.documentNumber}</p>
        <p className="text-sm opacity-75 mt-0.5">{invoice.customerName}</p>
      </div>

      {/* Invoice Summary */}
      <div className="px-6 py-4 border-b bg-muted/30">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-muted-foreground">Invoice Total</span>
          <span>{formatMWK(invoice.totalMinor)}</span>
        </div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-muted-foreground">Paid</span>
          <span>{formatMWK(invoice.paidMinor)}</span>
        </div>
        <div className="flex justify-between text-base font-semibold">
          <span>Balance Due</span>
          <span className="text-primary">{formatMWK(invoice.balanceMinor)}</span>
        </div>
      </div>

      {/* Steps */}
      <div className="p-6">
        {step === 'form' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="phone" className="text-sm font-medium">
                Mobile Money Number
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  +265
                </span>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="88 123 4567"
                  className="w-full pl-12 pr-4 py-2.5 border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
                  required
                />
              </div>
              {network && (
                <p className="text-xs text-muted-foreground">
                  Detected:{' '}
                  <span className="font-medium text-foreground">
                    {network === 'airtel' ? '📶 Airtel Money' : '📶 TNM Mpamba'}
                  </span>
                </p>
              )}
            </div>

            {allowPartial && (
              <div className="space-y-1.5">
                <label htmlFor="amount" className="text-sm font-medium">
                  Amount (MWK)
                </label>
                <input
                  id="amount"
                  type="number"
                  min={1}
                  max={invoice.balanceMinor / 100}
                  step="0.01"
                  value={amountMinor / 100}
                  onChange={(e) => setAmountMinor(Math.round(parseFloat(e.target.value || '0') * 100))}
                  className="w-full px-3 py-2.5 border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
                />
                <p className="text-xs text-muted-foreground">
                  Maximum: {formatMWK(invoice.balanceMinor)}
                </p>
              </div>
            )}

            {errorMsg && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2 text-sm text-destructive">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !network}
              className="w-full bg-primary text-primary-foreground rounded-md py-2.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
            >
              {submitting ? 'Initiating…' : `Pay ${formatMWK(amountMinor)}`}
            </button>

            {!network && phone.length > 0 && (
              <p className="text-xs text-center text-muted-foreground">
                Enter a valid Airtel Money (088/888) or TNM Mpamba (099/999) number.
              </p>
            )}
          </form>
        )}

        {step === 'processing' && (
          <div className="text-center space-y-4 py-4">
            <div className="text-5xl animate-pulse">📱</div>
            <div>
              <p className="font-semibold text-foreground">Waiting for payment…</p>
              <p className="text-sm text-muted-foreground mt-1">
                A prompt has been sent to <span className="font-mono">{phone}</span>.
                <br />
                Please enter your PIN to approve.
              </p>
            </div>
            <div className="flex justify-center gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-primary animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Do not close this page. This may take up to 2 minutes.
            </p>
          </div>
        )}

        {step === 'success' && (
          <div className="text-center space-y-4 py-4">
            <div className="text-5xl">🎉</div>
            <div>
              <p className="font-semibold text-lg text-foreground">Payment Successful!</p>
              <p className="text-sm text-muted-foreground mt-1">
                {formatMWK(amountMinor)} received. Thank you!
              </p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md px-4 py-3 text-sm text-green-700 dark:text-green-300">
              Invoice <span className="font-mono font-medium">{invoice.documentNumber}</span> has been updated.
            </div>
          </div>
        )}

        {step === 'failed' && (
          <div className="text-center space-y-4 py-4">
            <div className="text-5xl">❌</div>
            <div>
              <p className="font-semibold text-foreground">Payment Failed</p>
              <p className="text-sm text-muted-foreground mt-1">
                {errorMsg ?? 'Your payment could not be processed.'}
              </p>
            </div>
            <button
              onClick={() => {
                setStep('form');
                setErrorMsg(null);
                setSubmitting(false);
              }}
              className="w-full border border-input rounded-md py-2.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 pb-4 text-center text-xs text-muted-foreground">
        Secured payment — your number is never stored in plain text.
      </div>
    </div>
  );
}

