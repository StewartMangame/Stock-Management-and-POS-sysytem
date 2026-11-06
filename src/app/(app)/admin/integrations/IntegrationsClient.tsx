'use client';

/**
 * IntegrationsClient — tabbed admin UI for integrations management.
 * EIS Queue tab: pending, failed, rejected items with reasons, resend,
 * correct-and-resend, and an alert for items pending > 24 hours.
 */
import { useState, useRef, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Clock, AlertTriangle, Upload, RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { resendEisSubmissionAction, correctAndResendEisSubmissionAction } from './eis-actions';

// ── Types (mirror server row shapes we pass in) ──────────────────────────────

interface WebhookRow {
  id: string;
  provider: string;
  eventType: string | null;
  transactionReference: string | null;
  status: string;
  receivedAt: Date;
  processedAt: Date | null;
  errorMessage: string | null;
}

interface EisRow {
  id: string;
  documentId: string;
  documentType: string;
  status: string;
  attempts: number;
  nextRetryAt: Date;
  errorMessage: string | null;
  createdAt: Date;
}

interface ImportRow {
  id: string;
  profileId: string | null;
  filename: string | null;
  rowCount: number;
  importedAt: Date;
  importedBy: string | null;
}

interface EisCount {
  status: string;
  count: number;
}

interface EnvStatus {
  ONEKHUSA_BASE_URL: boolean;
  ONEKHUSA_ORGANISATION_ID: boolean;
  ONEKHUSA_MERCHANT_ACCOUNT_NUMBER: boolean;
  ONEKHUSA_WEBHOOK_SECRET: boolean;
  ONEKHUSA_API_KEY: boolean;
  ONEKHUSA_API_SECRET: boolean;
  PAYMENT_PROVIDER: string;
  EIS_ADAPTER: string;
}

interface Props {
  envStatus: EnvStatus;
  webhookRows: WebhookRow[];
  eisRows: EisRow[];
  importRows: ImportRow[];
  eisCounts: EisCount[];
}

type Tab = 'status' | 'webhooks' | 'statement' | 'eis';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: Date | null | string) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-MW', { dateStyle: 'short', timeStyle: 'short' });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    pending: 'secondary',
    processing: 'secondary',
    accepted: 'default',
    failed: 'destructive',
    confirmed: 'default',
    processed: 'default',
    error: 'destructive',
  };
  return <Badge variant={map[status] ?? 'outline'}>{status}</Badge>;
}

function EnvRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm py-1.5 border-b last:border-0">
      {ok ? (
        <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-destructive shrink-0" />
      )}
      <span className="font-mono text-xs flex-1">{label}</span>
      <span className={ok ? 'text-green-600 text-xs' : 'text-destructive text-xs'}>
        {ok ? 'set' : 'missing'}
      </span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function IntegrationsClient({ envStatus, webhookRows, eisRows, importRows, eisCounts }: Props) {
  const [tab, setTab] = useState<Tab>('status');
  const [uploading, setUploading] = useState(false);
  const [profileId, setProfileId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  // EIS correct-and-resend modal state
  const [correctingRow, setCorrectingRow] = useState<EisRow | null>(null);
  const [correctedPayload, setCorrectedPayload] = useState('');

  // Items pending > 24 hours
  const now = Date.now();
  const stalePendingRows = eisRows.filter(
    (r) =>
      (r.status === 'pending' || r.status === 'processing') &&
      now - new Date(r.createdAt).getTime() > 24 * 60 * 60 * 1000,
  );

  function handleResend(id: string) {
    startTransition(async () => {
      try {
        await resendEisSubmissionAction(id);
        toast.success('EIS submission re-queued for retry.');
      } catch (e: any) {
        toast.error(e.message);
      }
    });
  }

  function openCorrect(row: EisRow) {
    setCorrectingRow(row);
    // Try to show current payload if available; fall back to empty object template
    setCorrectedPayload('{\n  \n}');
  }

  function handleCorrectAndResend() {
    if (!correctingRow) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(correctedPayload);
    } catch {
      toast.error('Invalid JSON payload. Please correct before submitting.');
      return;
    }
    startTransition(async () => {
      try {
        await correctAndResendEisSubmissionAction(correctingRow.id, parsed);
        toast.success('EIS submission corrected and re-queued.');
        setCorrectingRow(null);
      } catch (e: any) {
        toast.error(e.message);
      }
    });
  }

  const providerReady =
    envStatus.ONEKHUSA_BASE_URL &&
    envStatus.ONEKHUSA_ORGANISATION_ID &&
    envStatus.ONEKHUSA_MERCHANT_ACCOUNT_NUMBER &&
    envStatus.ONEKHUSA_API_KEY &&
    envStatus.ONEKHUSA_API_SECRET;

  async function handleCsvUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error('Select a CSV file first.'); return; }
    if (!profileId) { toast.error('Enter a mapping profile ID.'); return; }

    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('profileId', profileId);

    try {
      const res = await fetch('/api/admin/statement-import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      toast.success(`Imported ${data.linesImported ?? 0} lines.`);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'status', label: 'OneKhusa Status' },
    { id: 'webhooks', label: `Webhooks (${webhookRows.length})` },
    { id: 'statement', label: 'Statement Import' },
    { id: 'eis', label: `EIS Queue (${eisRows.length})` },
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OneKhusa Status ── */}
      {tab === 'status' && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="border rounded-lg p-5 space-y-1">
            <div className="flex items-center gap-2 mb-3">
              {providerReady ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              )}
              <h3 className="font-semibold">Environment Variables</h3>
            </div>
            <EnvRow label="ONEKHUSA_BASE_URL" ok={envStatus.ONEKHUSA_BASE_URL} />
            <EnvRow label="ONEKHUSA_ORGANISATION_ID" ok={envStatus.ONEKHUSA_ORGANISATION_ID} />
            <EnvRow label="ONEKHUSA_MERCHANT_ACCOUNT_NUMBER" ok={envStatus.ONEKHUSA_MERCHANT_ACCOUNT_NUMBER} />
            <EnvRow label="ONEKHUSA_API_KEY" ok={envStatus.ONEKHUSA_API_KEY} />
            <EnvRow label="ONEKHUSA_API_SECRET" ok={envStatus.ONEKHUSA_API_SECRET} />
            <EnvRow label="ONEKHUSA_WEBHOOK_SECRET" ok={envStatus.ONEKHUSA_WEBHOOK_SECRET} />
          </div>

          <div className="border rounded-lg p-5 space-y-3">
            <h3 className="font-semibold">Adapter Configuration</h3>
            <div className="text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payment Provider</span>
                <Badge variant={envStatus.PAYMENT_PROVIDER === 'live' ? 'default' : 'secondary'}>
                  {envStatus.PAYMENT_PROVIDER}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">EIS Adapter</span>
                <Badge variant={envStatus.EIS_ADAPTER === 'live' ? 'default' : 'secondary'}>
                  {envStatus.EIS_ADAPTER}
                </Badge>
              </div>
            </div>
            {envStatus.PAYMENT_PROVIDER === 'mock' && (
              <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 rounded p-2">
                Set <code className="font-mono">PAYMENT_PROVIDER=live</code> in your environment to use real
                OneKhusa mobile money.
              </p>
            )}
          </div>

          <div className="border rounded-lg p-5 space-y-2 md:col-span-2">
            <h3 className="font-semibold mb-3">Webhook Stats (last 100)</h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              {['pending', 'processed', 'error'].map((s) => {
                const n = webhookRows.filter((r) => r.status === s).length;
                return (
                  <div key={s} className="border rounded p-3">
                    <p className="text-2xl font-bold">{n}</p>
                    <p className="text-xs text-muted-foreground capitalize">{s}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Webhooks ── */}
      {tab === 'webhooks' && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Received</th>
                <th className="px-4 py-2 text-left font-medium">Provider</th>
                <th className="px-4 py-2 text-left font-medium">Event</th>
                <th className="px-4 py-2 text-left font-medium">Reference</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {webhookRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    No webhook events received yet.
                  </td>
                </tr>
              )}
              {webhookRows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2 whitespace-nowrap">{fmt(row.receivedAt)}</td>
                  <td className="px-4 py-2">{row.provider}</td>
                  <td className="px-4 py-2 font-mono text-xs">{row.eventType ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{row.transactionReference ?? '—'}</td>
                  <td className="px-4 py-2"><StatusBadge status={row.status} /></td>
                  <td className="px-4 py-2 text-xs text-destructive max-w-xs truncate">
                    {row.errorMessage ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Statement Import ── */}
      {tab === 'statement' && (
        <div className="space-y-6">
          <div className="border rounded-lg p-5 space-y-4">
            <h3 className="font-semibold">Import Bank Statement CSV</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Mapping Profile ID</label>
                <input
                  value={profileId}
                  onChange={(e) => setProfileId(e.target.value)}
                  placeholder="e.g. fnb-mw-default"
                  className="w-full px-3 py-2 border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">CSV File</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-muted file:font-medium cursor-pointer"
                />
              </div>
            </div>
            <Button onClick={handleCsvUpload} disabled={uploading}>
              <Upload className="h-4 w-4 mr-2" />
              {uploading ? 'Importing…' : 'Import'}
            </Button>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b bg-muted/30 font-medium text-sm">Recent Imports</div>
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Imported At</th>
                  <th className="px-4 py-2 text-left font-medium">Profile</th>
                  <th className="px-4 py-2 text-left font-medium">File</th>
                  <th className="px-4 py-2 text-right font-medium">Rows</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {importRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                      No statement imports yet.
                    </td>
                  </tr>
                )}
                {importRows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2 whitespace-nowrap">{fmt(row.importedAt)}</td>
                    <td className="px-4 py-2 font-mono text-xs">{row.profileId}</td>
                    <td className="px-4 py-2 text-xs">{row.filename ?? '—'}</td>
                    <td className="px-4 py-2 text-right">{row.rowCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── EIS Queue ── */}
      {tab === 'eis' && (
        <div className="space-y-4">
          {/* Stale pending alert */}
          {stalePendingRows.length > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  {stalePendingRows.length} EIS submission{stalePendingRows.length > 1 ? 's' : ''} pending &gt; 24 hours
                </p>
                <p className="mt-1 text-xs">
                  These items may require manual intervention. Use &ldquo;Resend&rdquo; or &ldquo;Correct &amp; Resend&rdquo; to retry.
                </p>
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4">
            {(['pending', 'processing', 'accepted', 'failed'] as const).map((s) => {
              const c = eisCounts.find((e) => e.status === s);
              return (
                <div key={s} className="border rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold">{c?.count ?? 0}</p>
                  <p className="text-xs text-muted-foreground capitalize">{s}</p>
                </div>
              );
            })}
          </div>

          {/* EIS submissions table */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Created</th>
                  <th className="px-4 py-2 text-left font-medium">Document</th>
                  <th className="px-4 py-2 text-left font-medium">Type</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Attempts</th>
                  <th className="px-4 py-2 text-left font-medium">Next Retry</th>
                  <th className="px-4 py-2 text-left font-medium">Error / Reason</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {eisRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                      No EIS submissions yet.
                    </td>
                  </tr>
                )}
                {eisRows.map((row) => {
                  const isStale =
                    (row.status === 'pending' || row.status === 'processing') &&
                    now - new Date(row.createdAt).getTime() > 24 * 60 * 60 * 1000;
                  const canResend = row.status !== 'accepted';
                  return (
                    <tr key={row.id} className={isStale ? 'bg-amber-50/60 dark:bg-amber-900/10' : 'hover:bg-muted/20'}>
                      <td className="px-4 py-2 whitespace-nowrap text-xs">{fmt(row.createdAt)}</td>
                      <td className="px-4 py-2 font-mono text-xs">{row.documentId.slice(0, 8)}…</td>
                      <td className="px-4 py-2 capitalize text-xs">{row.documentType.replace('_', ' ')}</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={row.status} />
                        {isStale && (
                          <span className="ml-1 inline-flex items-center text-xs text-amber-600 font-medium">
                            <Clock className="h-3 w-3 mr-0.5" /> &gt;24h
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-xs">{row.attempts}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-xs">
                        {row.status === 'accepted' ? '—' : fmt(row.nextRetryAt)}
                      </td>
                      <td className="px-4 py-2 text-xs text-destructive max-w-xs truncate">
                        {row.errorMessage ?? ''}
                      </td>
                      <td className="px-4 py-2 text-right space-x-1">
                        {canResend && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={isPending}
                              onClick={() => handleResend(row.id)}
                            >
                              <RefreshCw className="h-3 w-3 mr-1" />
                              Resend
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              disabled={isPending}
                              onClick={() => openCorrect(row)}
                            >
                              Correct &amp; Resend
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Correct-and-resend modal */}
          {correctingRow && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-lg rounded-lg border bg-white dark:bg-zinc-900 shadow-xl p-6 space-y-4">
                <h2 className="text-base font-semibold">Correct &amp; Resend EIS Submission</h2>
                <p className="text-xs text-muted-foreground">
                  Document: <span className="font-mono">{correctingRow.documentId.slice(0, 8)}…</span>{' '}
                  ({correctingRow.documentType}) · Status: <StatusBadge status={correctingRow.status} />
                </p>
                {correctingRow.errorMessage && (
                  <div className="rounded bg-destructive/10 border border-destructive/30 p-2 text-xs text-destructive">
                    <strong>Error:</strong> {correctingRow.errorMessage}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">Corrected JSON Payload</label>
                  <textarea
                    className="w-full h-48 rounded border border-input bg-background p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    value={correctedPayload}
                    onChange={(e) => setCorrectedPayload(e.target.value)}
                    spellCheck={false}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setCorrectingRow(null)} disabled={isPending}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleCorrectAndResend} disabled={isPending}>
                    Correct &amp; Resend
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

