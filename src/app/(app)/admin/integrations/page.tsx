/**
 * /admin/integrations — Integrations Admin Screen
 * Tabs: OneKhusa Status | Webhook Events | Statement Import | EIS Queue
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import {
  webhookInbox,
  eisSubmissions,
  statementImports,
  statementMappingProfiles,
} from '@/server/db/schema';
import { desc, count, eq } from 'drizzle-orm';
import { IntegrationsClient } from './IntegrationsClient';

export const metadata: Metadata = { title: 'Integrations' };

export default async function IntegrationsPage() {
  try {
    await authorize(PERMISSIONS.SETTINGS_MANAGE);
  } catch {
    redirect('/dashboard');
  }

  const [webhookRows, eisRows, importRows, eisCounts] = await Promise.all([
    db
      .select()
      .from(webhookInbox)
      .orderBy(desc(webhookInbox.receivedAt))
      .limit(100),

    db
      .select()
      .from(eisSubmissions)
      .orderBy(desc(eisSubmissions.createdAt))
      .limit(100),

    db
      .select()
      .from(statementImports)
      .orderBy(desc(statementImports.importedAt))
      .limit(50),

    db
      .select({
        status: eisSubmissions.status,
        count: count(),
      })
      .from(eisSubmissions)
      .groupBy(eisSubmissions.status),
  ]);

  // Check env vars presence (boolean only — never expose values)
  const envStatus = {
    ONEKHUSA_BASE_URL: !!process.env.ONEKHUSA_BASE_URL,
    ONEKHUSA_ORGANISATION_ID: !!process.env.ONEKHUSA_ORGANISATION_ID,
    ONEKHUSA_MERCHANT_ACCOUNT_NUMBER: !!process.env.ONEKHUSA_MERCHANT_ACCOUNT_NUMBER,
    ONEKHUSA_WEBHOOK_SECRET: !!process.env.ONEKHUSA_WEBHOOK_SECRET,
    ONEKHUSA_API_KEY: !!process.env.ONEKHUSA_API_KEY,
    ONEKHUSA_API_SECRET: !!process.env.ONEKHUSA_API_SECRET,
    PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER ?? 'mock',
    EIS_ADAPTER: process.env.EIS_ADAPTER ?? 'mock',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ace-navy">Integrations</h1>
        <p className="text-sm text-ace-muted">
          OneKhusa mobile money, webhook events, bank statement import, and EIS queue.
        </p>
      </div>
      <IntegrationsClient
        envStatus={envStatus}
        webhookRows={webhookRows}
        eisRows={eisRows}
        importRows={importRows}
        eisCounts={eisCounts}
      />
    </div>
  );
}
