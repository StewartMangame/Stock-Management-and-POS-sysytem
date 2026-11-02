'use client';

/**
 * IntegrationsClient — tabbed admin UI for integrations management.
 */
import { useState, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Clock, AlertTriangle, Upload, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

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
          {/* Summary */}
          <div className="grid grid-cols-4 gap-4">
            {['pending', 'processing', 'accepted', 'failed'].map((s) => {
              const c = eisCounts.find((e) => e.status === s);
              return (
                <div key={s} className="border rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold">{c?.count ?? 0}</p>
                  <p className="text-xs text-muted-foreground capitalize">{s}</p>
                </div>
              );
            })}
          </div>

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
                  <th className="px-4 py-2 text-left font-medium">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {eisRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                      No EIS submissions yet.
                    </td>
                  </tr>
                )}
                {eisRows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2 whitespace-nowrap">{fmt(row.createdAt)}</td>
                    <td className="px-4 py-2 font-mono text-xs">{row.documentId.slice(0, 8)}…</td>
                    <td className="px-4 py-2 capitalize">{row.documentType.replace('_', ' ')}</td>
                    <td className="px-4 py-2"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-2 text-right">{row.attempts}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-xs">
                      {row.status === 'accepted' ? '—' : fmt(row.nextRetryAt)}
                    </td>
                    <td className="px-4 py-2 text-xs text-destructive max-w-xs truncate">
                      {row.errorMessage ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

