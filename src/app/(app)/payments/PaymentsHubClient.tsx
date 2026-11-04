'use client';

import React, { useState, useTransition } from 'react';
import {
  RefreshCw,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  recordPaymentFromLineAction,
  clearChequeAction,
  bounceChequeAction,
  revokePaymentLinkAction,
  resolveExceptionAction,
  pollProviderStatusAction,
  testGatewayConnectionAction,
} from './actions';
import type { PaymentsHubOverview } from '@/server/services/payments/payments-hub';

interface Props {
  userPermissions: string[];
  overview: PaymentsHubOverview;
  mobileMoneyData: any;
  bankStatementsData: any;
  pendingCheques: any[];
  paymentLinksData: any[];
  exceptionsData: any[];
  customersList: Array<{ id: string; name: string; accountNumber: string; isWalkIn: boolean }>;
  locationsList: Array<{ id: string; name: string }>;
  invoiceSuggestions?: Array<{ id: string; invoiceNumber: string; customerName: string; balanceMinor: number; customerId: string }>;
}

function fmtMWK(minor: number) {
  return `MWK ${(minor / 100).toLocaleString('en-MW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function PaymentsHubClient({
  userPermissions,
  overview,
  mobileMoneyData,
  bankStatementsData,
  pendingCheques,
  paymentLinksData,
  exceptionsData,
  customersList,
  locationsList,
  invoiceSuggestions = [],
}: Props) {
  const [activeTab, setActiveTab] = useState<'overview' | 'mobile-money' | 'statements' | 'cheques' | 'payment-links' | 'exceptions'>('overview');
  const [isPending, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modal state for recording payment from line
  const [selectedLine, setSelectedLine] = useState<any | null>(null);
  // Non-walk-in customers only
  const eligibleCustomers = customersList.filter((c) => !c.isWalkIn);
  const [selectedCustomer, setSelectedCustomer] = useState(eligibleCustomers[0]?.id || '');
  const [selectedLocation, setSelectedLocation] = useState(locationsList[0]?.id || '');
  // Invoice allocation: null = no invoice selected (becomes customer credit)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>('');
  // Suggestions for currently selected customer that are close in amount
  const lineSuggestions = invoiceSuggestions.filter(
    (s) => s.customerId === selectedCustomer
  );

  // Poll state
  const [pollResult, setPollResult] = useState<any | null>(null);

  // Copy state for payment links
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const canManageLinks = userPermissions.includes('payment_links:manage');
  const canManageExceptions = userPermissions.includes('payments:exceptions');
  const canClearCheques = userPermissions.includes('payments:cheque_clear');
  const canMatchStatements = userPermissions.includes('statements:match');

  const handleTestConnection = () => {
    startTransition(async () => {
      try {
        const res = await testGatewayConnectionAction();
        setStatusMessage({ text: res.message, type: 'success' });
      } catch (err: any) {
        setStatusMessage({ text: err.message, type: 'error' });
      }
    });
  };

  const handlePollStatus = (ref: string) => {
    startTransition(async () => {
      try {
        const res = await pollProviderStatusAction(ref);
        setPollResult(res);
        setStatusMessage({
          text: `Status for ${ref}: ${res.status.toUpperCase()} (${res.providerStatusName || res.providerStatusCode})`,
          type: 'success',
        });
      } catch (err: any) {
        setStatusMessage({ text: err.message, type: 'error' });
      }
    });
  };

  const handleRecordFromLine = () => {
    if (!selectedLine || !selectedCustomer || !selectedLocation) return;
    // Walk-in guard: eligibleCustomers already excludes walk-in customers
    startTransition(async () => {
      try {
        const allocations = selectedInvoiceId
          ? [{ invoiceId: selectedInvoiceId, amountMinor: selectedLine.amountMinor }]
          : [];
        const res = await recordPaymentFromLineAction({
          statementLineId: selectedLine.id,
          customerId: selectedCustomer,
          locationId: selectedLocation,
          allocations,
        });
        const msg = selectedInvoiceId
          ? 'Payment recorded and applied to invoice. Statement line reconciled.'
          : 'Payment recorded and credited to customer account (no invoice selected). Statement line reconciled.';
        setStatusMessage({ text: msg, type: 'success' });
        setSelectedLine(null);
        setSelectedInvoiceId('');
      } catch (err: any) {
        setStatusMessage({ text: err.message, type: 'error' });
      }
    });
  };

  const handleClearCheque = (id: string) => {
    if (!confirm('Confirm clearing this cheque? This will mark the payment as confirmed and credit the customer account.')) return;
    startTransition(async () => {
      try {
        await clearChequeAction(id);
        setStatusMessage({ text: 'Cheque cleared successfully.', type: 'success' });
      } catch (err: any) {
        setStatusMessage({ text: err.message, type: 'error' });
      }
    });
  };

  const handleBounceCheque = (id: string) => {
    const reason = prompt('Enter reason for bouncing this cheque:');
    if (!reason) return;
    startTransition(async () => {
      try {
        await bounceChequeAction(id, reason);
        setStatusMessage({ text: 'Cheque marked as failed (bounced). Any unpaid invoices remain open.', type: 'success' });
      } catch (err: any) {
        setStatusMessage({ text: err.message, type: 'error' });
      }
    });
  };

  const handleRevokeLink = (id: string) => {
    if (!confirm('Revoke this payment link? Payer will no longer be able to complete payment.')) return;
    startTransition(async () => {
      try {
        await revokePaymentLinkAction(id);
        setStatusMessage({ text: 'Payment link revoked.', type: 'success' });
      } catch (err: any) {
        setStatusMessage({ text: err.message, type: 'error' });
      }
    });
  };

  const handleResolveException = (id: string) => {
    const note = prompt('Enter resolution note for this exception:');
    if (!note) return;
    startTransition(async () => {
      try {
        await resolveExceptionAction(id, note);
        setStatusMessage({ text: 'Exception resolved and cleared.', type: 'success' });
      } catch (err: any) {
        setStatusMessage({ text: err.message, type: 'error' });
      }
    });
  };

  const handleCopy = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Status banner */}
      {statusMessage && (
        <div
          className={`flex items-center justify-between rounded-lg p-3 text-sm ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <span>{statusMessage.text}</span>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-xs font-semibold underline ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs navigation */}
      <div className="border-b border-ace-band">
        <nav className="flex space-x-4 overflow-x-auto pb-px">
          <button
            onClick={() => setActiveTab('overview')}
            className={`whitespace-nowrap pb-3 text-sm font-medium border-b-2 transition ${
              activeTab === 'overview'
                ? 'border-ace-blue text-ace-navy'
                : 'border-transparent text-ace-muted hover:text-ace-navy'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('mobile-money')}
            className={`whitespace-nowrap pb-3 text-sm font-medium border-b-2 transition ${
              activeTab === 'mobile-money'
                ? 'border-ace-blue text-ace-navy'
                : 'border-transparent text-ace-muted hover:text-ace-navy'
            }`}
          >
            Mobile Money (OneKhusa)
          </button>
          <button
            onClick={() => setActiveTab('statements')}
            className={`whitespace-nowrap pb-3 text-sm font-medium border-b-2 transition ${
              activeTab === 'statements'
                ? 'border-ace-blue text-ace-navy'
                : 'border-transparent text-ace-muted hover:text-ace-navy'
            }`}
          >
            Bank Statements & Matching
          </button>
          <button
            onClick={() => setActiveTab('cheques')}
            className={`whitespace-nowrap pb-3 text-sm font-medium border-b-2 transition ${
              activeTab === 'cheques'
                ? 'border-ace-blue text-ace-navy'
                : 'border-transparent text-ace-muted hover:text-ace-navy'
            }`}
          >
            Cheques ({pendingCheques.length})
          </button>
          {canManageLinks && (
            <button
              onClick={() => setActiveTab('payment-links')}
              className={`whitespace-nowrap pb-3 text-sm font-medium border-b-2 transition ${
                activeTab === 'payment-links'
                  ? 'border-ace-blue text-ace-navy'
                  : 'border-transparent text-ace-muted hover:text-ace-navy'
              }`}
            >
              Payment Links ({paymentLinksData.length})
            </button>
          )}
          {canManageExceptions && (
            <button
              onClick={() => setActiveTab('exceptions')}
              className={`whitespace-nowrap pb-3 text-sm font-medium border-b-2 transition ${
                activeTab === 'exceptions'
                  ? 'border-ace-blue text-ace-navy'
                  : 'border-transparent text-ace-muted hover:text-ace-navy'
              }`}
            >
              Exceptions ({exceptionsData.length})
            </button>
          )}
        </nav>
      </div>

      {/* ── 1. Overview Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Card className="border-ace-band">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                  Total Receipts Today
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-ace-navy">{fmtMWK(overview.todayTotalMinor)}</div>
                <p className="mt-1 text-xs text-ace-muted">Confirmed inflows today</p>
              </CardContent>
            </Card>

            <Card className="border-ace-band">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                  Pending Payments
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-700">{overview.pendingCount}</div>
                <p className="mt-1 text-xs text-ace-muted">Awaiting confirmation or clearance</p>
              </CardContent>
            </Card>

            <Card className="border-ace-band">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                  Unreconciled
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-700">{overview.unreconciledCount}</div>
                <p className="mt-1 text-xs text-ace-muted">Awaiting bank statement match</p>
              </CardContent>
            </Card>

            <Card className="border-ace-band">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                  Exceptions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-rose-700">{overview.exceptionsCount}</div>
                <p className="mt-1 text-xs text-ace-muted">Flagged transactions requiring review</p>
              </CardContent>
            </Card>
          </div>

          {/* Today's Receipts Breakdown */}
          <Card className="border-ace-band">
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-ace-navy">Today&apos;s Receipts by Method</CardTitle>
              <CardDescription className="text-xs text-ace-muted">Confirmed payments received in Africa/Blantyre day</CardDescription>
            </CardHeader>
            <CardContent>
              {overview.receiptsToday.length === 0 ? (
                <p className="text-sm text-ace-muted">No payments recorded today.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-ace-band text-xs text-ace-muted">
                        <th className="pb-2">Payment Method</th>
                        <th className="pb-2 text-right">Transactions</th>
                        <th className="pb-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ace-band">
                      {overview.receiptsToday.map((r) => (
                        <tr key={r.method}>
                          <td className="py-2.5 font-medium text-ace-navy capitalize">{r.method.replace('_', ' ')}</td>
                          <td className="py-2.5 text-right text-ace-muted">{r.count}</td>
                          <td className="py-2.5 text-right font-semibold text-ace-navy">{fmtMWK(r.totalMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── 2. Mobile Money Tab ────────────────────────────────────────────── */}
      {activeTab === 'mobile-money' && (
        <div className="space-y-6">
          <Card className="border-ace-band">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-sm font-semibold text-ace-navy">OneKhusa Gateway Integration</CardTitle>
                <CardDescription className="text-xs text-ace-muted">
                  Airtel Money and TNM Mpamba push prompt processing & webhook inbox
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={mobileMoneyData.environment === 'PRODUCTION' ? 'default' : 'secondary'}>
                  {mobileMoneyData.environment}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={isPending}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Test Connection
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
                <div className="rounded-md border border-ace-band p-3">
                  <span className="text-ace-muted block mb-1">API Base Endpoint</span>
                  <code className="text-ace-navy font-mono">{mobileMoneyData.baseUrl}</code>
                </div>
                <div className="rounded-md border border-ace-band p-3">
                  <span className="text-ace-muted block mb-1">Last Webhook Received</span>
                  <span className="text-ace-navy font-medium">
                    {mobileMoneyData.lastWebhookReceivedAt
                      ? `${new Date(mobileMoneyData.lastWebhookReceivedAt).toLocaleString()} — ${mobileMoneyData.lastWebhookEvent}`
                      : 'None received yet'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recent Mobile Money Transactions */}
          <Card className="border-ace-band">
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-ace-navy">Recent Mobile Transactions</CardTitle>
              <CardDescription className="text-xs text-ace-muted">
                Poll now is strictly read-only on the gateway provider
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mobileMoneyData.recentTransactions.length === 0 ? (
                <p className="text-sm text-ace-muted">No mobile money transactions recorded.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-ace-band text-xs text-ace-muted">
                        <th className="pb-2">Receipt #</th>
                        <th className="pb-2">Customer</th>
                        <th className="pb-2">Method</th>
                        <th className="pb-2">Provider Ref</th>
                        <th className="pb-2 text-right">Amount</th>
                        <th className="pb-2">Status</th>
                        <th className="pb-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ace-band text-xs">
                      {mobileMoneyData.recentTransactions.map((tx: any) => (
                        <tr key={tx.id}>
                          <td className="py-2.5 font-medium text-ace-navy">{tx.paymentNumber}</td>
                          <td className="py-2.5 text-ace-muted">{tx.customerName || 'Walk-in'}</td>
                          <td className="py-2.5 uppercase font-medium">{tx.method.replace('_', ' ')}</td>
                          <td className="py-2.5 font-mono text-xs">{tx.providerReference || '—'}</td>
                          <td className="py-2.5 text-right font-semibold text-ace-navy">{fmtMWK(tx.amountMinor)}</td>
                          <td className="py-2.5">
                            <Badge variant={tx.status === 'confirmed' ? 'default' : 'secondary'}>
                              {tx.status}
                            </Badge>
                          </td>
                          <td className="py-2.5 text-right">
                            {tx.providerReference && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handlePollStatus(tx.providerReference)}
                                disabled={isPending}
                                className="h-7 px-2 text-xs"
                              >
                                Poll Now
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── 3. Bank Statements & Matching Tab ───────────────────────────────── */}
      {activeTab === 'statements' && (
        <div className="space-y-6">
          <Card className="border-ace-band">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold text-ace-navy">Unmatched Bank Statement Lines</CardTitle>
                <CardDescription className="text-xs text-ace-muted">
                  Record payments directly from statement lines or match to existing payments
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {bankStatementsData.unmatchedLines.length === 0 ? (
                <p className="text-sm text-ace-muted">All imported statement lines have been matched.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-ace-band text-xs text-ace-muted">
                        <th className="pb-2">Date</th>
                        <th className="pb-2">Reference</th>
                        <th className="pb-2">Description</th>
                        <th className="pb-2 text-right">Amount</th>
                        <th className="pb-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ace-band text-xs">
                      {bankStatementsData.unmatchedLines.map((line: any) => (
                        <tr key={line.id}>
                          <td className="py-2.5 text-ace-muted">{line.transactionDate}</td>
                          <td className="py-2.5 font-mono">{line.reference || '—'}</td>
                          <td className="py-2.5 text-ace-navy">{line.description || '—'}</td>
                          <td className="py-2.5 text-right font-semibold text-ace-navy">{fmtMWK(line.amountMinor)}</td>
                          <td className="py-2.5 text-right">
                            {canMatchStatements && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedLine(line)}
                                className="h-7 text-xs"
                              >
                                Record Payment From Line
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Modal / Dialog for Recording Payment from Line */}
          {selectedLine && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <Card className="w-full max-w-lg border-ace-band bg-white">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold text-ace-navy">Record Payment from Statement Line</CardTitle>
                  <CardDescription className="text-xs text-ace-muted">
                    Atomically creates confirmed payment and matches line. Matched only once.
                    Requires payments:record AND statements:match.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-xs">
                  <div className="rounded bg-ace-band/40 p-3 space-y-1">
                    <div><span className="font-semibold">Line Amount:</span> {fmtMWK(selectedLine.amountMinor)}</div>
                    <div><span className="font-semibold">Reference:</span> {selectedLine.reference || '—'}</div>
                    <div><span className="font-semibold">Date:</span> {selectedLine.transactionDate}</div>
                    <div><span className="font-semibold">Description:</span> {selectedLine.description || '—'}</div>
                  </div>
                  <div>
                    <label className="block font-medium text-ace-navy mb-1">Customer (walk-in not allowed)</label>
                    <select
                      value={selectedCustomer}
                      onChange={(e) => { setSelectedCustomer(e.target.value); setSelectedInvoiceId(''); }}
                      className="w-full rounded border border-ace-band p-2 text-xs"
                    >
                      {eligibleCustomers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.accountNumber})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-ace-navy mb-1">Location</label>
                    <select
                      value={selectedLocation}
                      onChange={(e) => setSelectedLocation(e.target.value)}
                      className="w-full rounded border border-ace-band p-2 text-xs"
                    >
                      {locationsList.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-ace-navy mb-1">
                      Apply to Invoice (optional — leave blank to credit customer account)
                    </label>
                    <select
                      value={selectedInvoiceId}
                      onChange={(e) => setSelectedInvoiceId(e.target.value)}
                      className="w-full rounded border border-ace-band p-2 text-xs"
                    >
                      <option value="">— No invoice: credit customer account —</option>
                      {lineSuggestions.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoiceNumber} · {inv.customerName} · Balance: {fmtMWK(inv.balanceMinor)}
                        </option>
                      ))}
                    </select>
                    {!selectedInvoiceId && (
                      <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-amber-700 text-xs">
                        No invoice selected — payment will be credited to the customer account.
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setSelectedLine(null); setSelectedInvoiceId(''); }}
                      disabled={isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleRecordFromLine}
                      disabled={isPending}
                    >
                      {selectedInvoiceId ? 'Record & Apply to Invoice' : 'Record as Customer Credit'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* ── 4. Cheques Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'cheques' && (
        <Card className="border-ace-band">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-ace-navy">Pending Cheques for Clearance</CardTitle>
            <CardDescription className="text-xs text-ace-muted">
              Clear confirmed cheques or mark bounced (sets status to failed, never reversed).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pendingCheques.length === 0 ? (
              <p className="text-sm text-ace-muted">No pending cheques awaiting clearing.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-ace-band text-xs text-ace-muted">
                      <th className="pb-2">Receipt #</th>
                      <th className="pb-2">Customer</th>
                      <th className="pb-2">Cheque #</th>
                      <th className="pb-2">Bank</th>
                      <th className="pb-2">Cheque Date</th>
                      <th className="pb-2 text-right">Amount</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ace-band text-xs">
                    {pendingCheques.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2.5 font-medium text-ace-navy">{c.paymentNumber}</td>
                        <td className="py-2.5 text-ace-navy">{c.customerName}</td>
                        <td className="py-2.5 font-mono">{c.chequeNumber}</td>
                        <td className="py-2.5">{c.bankName}</td>
                        <td className="py-2.5 text-ace-muted">{c.chequeDate}</td>
                        <td className="py-2.5 text-right font-semibold text-ace-navy">{fmtMWK(c.amountMinor)}</td>
                        <td className="py-2.5 text-right space-x-2">
                          {canClearCheques && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleClearCheque(c.id)}
                                disabled={isPending}
                                className="h-7 text-xs text-emerald-700"
                              >
                                Clear
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleBounceCheque(c.id)}
                                disabled={isPending}
                                className="h-7 text-xs text-rose-700"
                              >
                                Bounce
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── 5. Payment Links Tab ───────────────────────────────────────────── */}
      {activeTab === 'payment-links' && canManageLinks && (
        <Card className="border-ace-band">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-ace-navy">Active Payment Links</CardTitle>
            <CardDescription className="text-xs text-ace-muted">
              Secure links allowing customer self-service mobile payments
            </CardDescription>
          </CardHeader>
          <CardContent>
            {paymentLinksData.length === 0 ? (
              <p className="text-sm text-ace-muted">No active payment links.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-ace-band text-xs text-ace-muted">
                      <th className="pb-2">Invoice #</th>
                      <th className="pb-2">Customer</th>
                      <th className="pb-2 text-right">Balance</th>
                      <th className="pb-2">Expires</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ace-band text-xs">
                    {paymentLinksData.map((l) => (
                      <tr key={l.id}>
                        <td className="py-2.5 font-medium text-ace-navy">{l.invoiceNumber}</td>
                        <td className="py-2.5 text-ace-navy">{l.customerName}</td>
                        <td className="py-2.5 text-right font-semibold text-ace-navy">{fmtMWK(l.balanceMinor)}</td>
                        <td className="py-2.5 text-ace-muted">{new Date(l.expiresAt).toLocaleDateString()}</td>
                        <td className="py-2.5">
                          <Badge variant={l.status === 'active' ? 'default' : 'secondary'}>
                            {l.status}
                          </Badge>
                        </td>
                        <td className="py-2.5 text-right space-x-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCopy(l.id, `${window.location.origin}/pay/${l.id}`)}
                            className="h-7 px-2 text-xs"
                          >
                            {copiedId === l.id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                          </Button>
                          {l.status === 'active' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRevokeLink(l.id)}
                              disabled={isPending}
                              className="h-7 text-xs text-rose-700"
                            >
                              Revoke
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── 6. Exceptions Tab ──────────────────────────────────────────────── */}
      {activeTab === 'exceptions' && canManageExceptions && (
        <Card className="border-ace-band">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-ace-navy">Flagged Exceptions Register</CardTitle>
            <CardDescription className="text-xs text-ace-muted">
              Payments flagged by automated risk checks or provider notifications requiring manager override
            </CardDescription>
          </CardHeader>
          <CardContent>
            {exceptionsData.length === 0 ? (
              <p className="text-sm text-ace-muted">No unresolved exceptions.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-ace-band text-xs text-ace-muted">
                      <th className="pb-2">Receipt #</th>
                      <th className="pb-2">Customer</th>
                      <th className="pb-2">Flag Type</th>
                      <th className="pb-2">Reason</th>
                      <th className="pb-2 text-right">Amount</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ace-band text-xs">
                    {exceptionsData.map((f) => (
                      <tr key={f.id}>
                        <td className="py-2.5 font-medium text-ace-navy">{f.paymentNumber}</td>
                        <td className="py-2.5 text-ace-navy">{f.customerName}</td>
                        <td className="py-2.5">
                          <Badge variant="destructive">{f.flagType}</Badge>
                        </td>
                        <td className="py-2.5 text-ace-muted">{f.flagReason}</td>
                        <td className="py-2.5 text-right font-semibold text-ace-navy">{fmtMWK(f.amountMinor)}</td>
                        <td className="py-2.5 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleResolveException(f.id)}
                            disabled={isPending}
                            className="h-7 text-xs text-emerald-700"
                          >
                            Resolve Flag
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

