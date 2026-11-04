/**
 * Payments Hub Service (Phase 6).
 *
 * Consolidates all payment operations, mobile money gateways,
 * bank statement reconciliation, cheque clearing, payment links, and exceptions.
 */

import { db } from '@/server/db';
import { sql, desc, eq, and, isNotNull } from 'drizzle-orm';
import { startOfDayInCompanyTz, todayInCompanyTz } from '@/lib/timezone';
import {
  payments,
  customers,
  statementImports,
  statementLines,
  paymentLinks,
  salesDocuments,
  webhookInbox,
} from '@/server/db/schema';

function nextDayStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00+02:00');
  d.setDate(d.getDate() + 1);
  return d;
}

export interface ReceiptsByMethod {
  method: string;
  count: number;
  totalMinor: number;
}

export interface PaymentsHubOverview {
  receiptsToday: ReceiptsByMethod[];
  todayTotalMinor: number;
  pendingCount: number;
  awaitingSaleCount: number;
  unreconciledCount: number;
  exceptionsCount: number;
}

export async function getPaymentsHubOverview(): Promise<PaymentsHubOverview> {
  const today = todayInCompanyTz();
  const fromInstant = startOfDayInCompanyTz(today);
  const toInstant = nextDayStart(today);

  // 1. Receipts today by method
  const receiptsRes = await db.execute<{
    method: string;
    count: string;
    total_minor: string;
  }>(sql`
    SELECT
      method,
      COUNT(*)::text AS count,
      COALESCE(SUM(amount_minor), 0)::text AS total_minor
    FROM payments
    WHERE kind = 'receipt'
      AND status = 'confirmed'
      AND confirmed_at >= ${fromInstant}
      AND confirmed_at < ${toInstant}
    GROUP BY method
    ORDER BY total_minor DESC
  `);

  const receiptsToday: ReceiptsByMethod[] = receiptsRes.rows.map((r) => ({
    method: r.method,
    count: Number(r.count),
    totalMinor: Number(r.total_minor),
  }));

  const todayTotalMinor = receiptsToday.reduce((sum, r) => sum + r.totalMinor, 0);

  // 2. Lifecycle status counts
  const countsRes = await db.execute<{
    pending_count: string;
    awaiting_sale_count: string;
    unreconciled_count: string;
    exceptions_count: string;
  }>(sql`
    SELECT
      COUNT(CASE WHEN status = 'pending' THEN 1 END)::text AS pending_count,
      COUNT(CASE WHEN status = 'awaiting_sale' THEN 1 END)::text AS awaiting_sale_count,
      COUNT(CASE WHEN reconciliation_status = 'unreconciled' AND status NOT IN ('failed', 'reversed') THEN 1 END)::text AS unreconciled_count,
      COUNT(CASE WHEN flag_type IS NOT NULL THEN 1 END)::text AS exceptions_count
    FROM payments
  `);

  const cRow = countsRes.rows[0];

  return {
    receiptsToday,
    todayTotalMinor,
    pendingCount: Number(cRow?.pending_count || 0),
    awaitingSaleCount: Number(cRow?.awaiting_sale_count || 0),
    unreconciledCount: Number(cRow?.unreconciled_count || 0),
    exceptionsCount: Number(cRow?.exceptions_count || 0),
  };
}

export async function getMobileMoneyData() {
  const isSandbox = (process.env.ONEKHUSA_BASE_URL || '').toLowerCase().includes('sandbox') ||
    !process.env.ONEKHUSA_BASE_URL;

  // Last webhook received
  const [lastWebhook] = await db
    .select({
      receivedAt: webhookInbox.receivedAt,
      eventType: webhookInbox.eventType,
      status: webhookInbox.status,
      ref: webhookInbox.transactionReference,
    })
    .from(webhookInbox)
    .orderBy(desc(webhookInbox.receivedAt))
    .limit(1);

  // Recent mobile money transactions
  const recentTxs = await db
    .select({
      id: payments.id,
      paymentNumber: payments.paymentNumber,
      method: payments.method,
      amountMinor: payments.amountMinor,
      status: payments.status,
      providerReference: payments.providerReference,
      confirmedAt: payments.confirmedAt,
      customerName: customers.name,
    })
    .from(payments)
    .leftJoin(customers, eq(payments.customerId, customers.id))
    .where(sql`${payments.method} IN ('airtel_money', 'mpamba') OR ${payments.provider} = 'onekhusa'`)
    .orderBy(desc(payments.createdAt))
    .limit(20);

  return {
    providerName: 'OneKhusa Mobile Money Gateway',
    environment: isSandbox ? 'SANDBOX' : 'PRODUCTION',
    baseUrl: process.env.ONEKHUSA_BASE_URL || 'https://api.onekhusa.com/sandbox/v1',
    lastWebhookReceivedAt: lastWebhook ? lastWebhook.receivedAt.toISOString() : null,
    lastWebhookEvent: lastWebhook ? `${lastWebhook.eventType} (${lastWebhook.status})` : null,
    recentTransactions: recentTxs.map((t) => ({
      ...t,
      confirmedAt: t.confirmedAt ? t.confirmedAt.toISOString() : null,
    })),
  };
}

export async function getBankStatementsData() {
  const imports = await db
    .select({
      id: statementImports.id,
      filename: statementImports.filename,
      rowCount: statementImports.rowCount,
      totalAmountMinor: statementImports.totalAmountMinor,
      importedAt: statementImports.importedAt,
    })
    .from(statementImports)
    .orderBy(desc(statementImports.importedAt))
    .limit(10);

  const unmatchedLines = await db
    .select({
      id: statementLines.id,
      importId: statementLines.importId,
      lineNumber: statementLines.lineNumber,
      transactionDate: statementLines.transactionDate,
      reference: statementLines.reference,
      description: statementLines.description,
      amountMinor: statementLines.amountMinor,
      feeMinor: statementLines.feeMinor,
      matchStatus: statementLines.matchStatus,
    })
    .from(statementLines)
    .where(eq(statementLines.matchStatus, 'unmatched'))
    .orderBy(desc(statementLines.transactionDate))
    .limit(50);

  return {
    imports: imports.map((i) => ({
      ...i,
      importedAt: i.importedAt.toISOString(),
    })),
    unmatchedLines: unmatchedLines.map((l) => ({
      ...l,
      transactionDate: l.transactionDate ? String(l.transactionDate) : '',
    })),
  };
}

export async function getPendingChequesData() {
  const pendingCheques = await db
    .select({
      id: payments.id,
      paymentNumber: payments.paymentNumber,
      amountMinor: payments.amountMinor,
      status: payments.status,
      paymentDate: payments.paymentDate,
      methodDetails: payments.methodDetails,
      customerName: customers.name,
      notes: payments.notes,
    })
    .from(payments)
    .leftJoin(customers, eq(payments.customerId, customers.id))
    .where(and(eq(payments.method, 'cheque'), eq(payments.status, 'pending')))
    .orderBy(desc(payments.createdAt));

  return pendingCheques.map((c) => {
    const details = (c.methodDetails as any) || {};
    return {
      id: c.id,
      paymentNumber: c.paymentNumber,
      customerName: c.customerName ?? 'Unknown Customer',
      amountMinor: c.amountMinor,
      chequeNumber: details.cheque_number || details.chequeNumber || '—',
      bankName: details.bank_name || details.bankName || '—',
      chequeDate: details.cheque_date || details.chequeDate || c.paymentDate,
      notes: c.notes,
    };
  });
}

export async function getPaymentLinksData() {
  const links = await db
    .select({
      id: paymentLinks.id,
      invoiceId: paymentLinks.invoiceId,
      invoiceNumber: salesDocuments.documentNumber,
      customerName: customers.name,
      totalMinor: salesDocuments.totalMinor,
      balanceMinor: salesDocuments.balanceMinor,
      status: paymentLinks.status,
      expiresAt: paymentLinks.expiresAt,
      createdAt: paymentLinks.createdAt,
    })
    .from(paymentLinks)
    .innerJoin(salesDocuments, eq(paymentLinks.invoiceId, salesDocuments.id))
    .innerJoin(customers, eq(salesDocuments.customerId, customers.id))
    .orderBy(desc(paymentLinks.createdAt))
    .limit(50);

  return links.map((l) => ({
    id: l.id,
    invoiceId: l.invoiceId,
    invoiceNumber: l.invoiceNumber,
    customerName: l.customerName,
    totalMinor: l.totalMinor,
    balanceMinor: l.balanceMinor,
    status: l.status,
    expiresAt: l.expiresAt.toISOString(),
    createdAt: l.createdAt.toISOString(),
  }));
}

export async function getExceptionsData() {
  const flagged = await db
    .select({
      id: payments.id,
      paymentNumber: payments.paymentNumber,
      amountMinor: payments.amountMinor,
      method: payments.method,
      status: payments.status,
      flagType: payments.flagType,
      flagReason: payments.flagReason,
      flaggedAt: payments.flaggedAt,
      providerReference: payments.providerReference,
      customerName: customers.name,
    })
    .from(payments)
    .leftJoin(customers, eq(payments.customerId, customers.id))
    .where(isNotNull(payments.flagType))
    .orderBy(desc(payments.flaggedAt))
    .limit(100);

  return flagged.map((f) => ({
    id: f.id,
    paymentNumber: f.paymentNumber,
    customerName: f.customerName ?? 'Walk-in / Unknown',
    amountMinor: f.amountMinor,
    method: f.method,
    status: f.status,
    flagType: f.flagType ?? 'unspecified',
    flagReason: f.flagReason ?? 'Requires review',
    flaggedAt: f.flaggedAt ? f.flaggedAt.toISOString() : null,
    providerReference: f.providerReference ?? '—',
  }));
}

