import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { customers, locations, salesDocuments } from '@/server/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  getPaymentsHubOverview,
  getMobileMoneyData,
  getBankStatementsData,
  getPendingChequesData,
  getPaymentLinksData,
  getExceptionsData,
} from '@/server/services/payments/payments-hub';
import PaymentsHubClient from './PaymentsHubClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Payments Hub — Ace Holdings' };

export default async function PaymentsHubPage() {
  try {
    await authorize(PERMISSIONS.PAYMENTS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const session = await auth();
  const userPermissions = (session?.user as any)?.permissions || [];

  const [
    overview,
    mobileMoneyData,
    bankStatementsData,
    pendingCheques,
    paymentLinksData,
    exceptionsData,
    custs,
    locs,
    invoiceSuggestionsRaw,
  ] = await Promise.all([
    getPaymentsHubOverview(),
    getMobileMoneyData(),
    getBankStatementsData(),
    getPendingChequesData(),
    getPaymentLinksData(),
    getExceptionsData(),
    // Include isWalkIn so the client can filter walk-in customers out of the picker
    db
      .select({
        id: customers.id,
        name: customers.name,
        accountNumber: customers.accountNumber,
        isWalkIn: customers.isWalkIn,
      })
      .from(customers)
      .where(eq(customers.isActive, true))
      .limit(500),
    db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(eq(locations.isActive, true)),
    // Invoice suggestions: open invoices with a balance, ordered by recency
    // Suggestions are matched by customer and amount in the client
    db.execute<{
      id: string;
      invoiceNumber: string;
      customerName: string;
      balanceMinor: string;
      customerId: string;
    }>(sql`
      SELECT
        sd.id,
        sd.document_number AS "invoiceNumber",
        c.name             AS "customerName",
        sd.balance_minor   AS "balanceMinor",
        sd.customer_id     AS "customerId"
      FROM sales_documents sd
      JOIN customers c ON c.id = sd.customer_id
      WHERE sd.document_type = 'invoice'
        AND sd.status = 'issued'
        AND sd.balance_minor > 0
        AND c.is_walk_in = FALSE
      ORDER BY sd.issue_date DESC
      LIMIT 200
    `),
  ]);

  const invoiceSuggestions = invoiceSuggestionsRaw.rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber ?? '',
    customerName: r.customerName,
    balanceMinor: Number(r.balanceMinor),
    customerId: r.customerId,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ace-navy">Payments Hub</h1>
        <p className="text-sm text-ace-muted">
          Multi-channel payment clearing, mobile money gateways, bank reconciliation, and fraud exceptions.
        </p>
      </div>

      <PaymentsHubClient
        userPermissions={userPermissions}
        overview={overview}
        mobileMoneyData={mobileMoneyData}
        bankStatementsData={bankStatementsData}
        pendingCheques={pendingCheques}
        paymentLinksData={paymentLinksData}
        exceptionsData={exceptionsData}
        customersList={custs}
        locationsList={locs}
        invoiceSuggestions={invoiceSuggestions}
      />
    </div>
  );
}
