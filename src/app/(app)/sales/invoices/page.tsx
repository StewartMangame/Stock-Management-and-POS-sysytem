import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { salesDocuments, customers, salesDocumentLines } from '@/server/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { InvoicesTable, type InvoiceListItem } from './InvoicesTable';

export const metadata: Metadata = {
  title: 'Invoices | Ace Holdings POS',
};

export default async function InvoicesPage() {
  try {
    await authorize(PERMISSIONS.INVOICES_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const rows = await db
    .select({
      id: salesDocuments.id,
      documentNumber: salesDocuments.documentNumber,
      customerName: customers.name,
      customerAccount: customers.accountNumber,
      issueDate: salesDocuments.issueDate,
      dueDate: salesDocuments.dueDate,
      status: salesDocuments.status,
      deliveryStatus: salesDocuments.deliveryStatus,
      paymentStatus: salesDocuments.paymentStatus,
      totalMinor: salesDocuments.totalMinor,
      balanceMinor: salesDocuments.balanceMinor,
      linesCount: sql<string>`count(${salesDocumentLines.id})`,
    })
    .from(salesDocuments)
    .innerJoin(customers, eq(salesDocuments.customerId, customers.id))
    .leftJoin(salesDocumentLines, eq(salesDocuments.id, salesDocumentLines.documentId))
    .where(eq(salesDocuments.documentType, 'invoice'))
    .groupBy(salesDocuments.id, customers.name, customers.accountNumber)
    .orderBy(desc(salesDocuments.createdAt));

  const items: InvoiceListItem[] = rows.map((r) => ({
    id: r.id,
    documentNumber: r.documentNumber,
    customerName: r.customerName,
    customerAccount: r.customerAccount,
    issueDate: r.issueDate ? new Date(r.issueDate).toISOString() : '',
    dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : '',
    status: r.status as 'draft' | 'issued' | 'void',
    deliveryStatus: r.deliveryStatus as 'not_delivered' | 'partly_delivered' | 'delivered',
    paymentStatus: r.paymentStatus as 'unpaid' | 'partly_paid' | 'paid',
    totalMinor: r.totalMinor,
    balanceMinor: r.balanceMinor,
    linesCount: parseInt(r.linesCount || '0', 10),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ace-navy">Sales Invoices</h1>
        <p className="text-sm text-muted-foreground">
          Manage corporate sales invoices, track delivery fulfillment and customer payments, and issue credit adjustments.
        </p>
      </div>

      <InvoicesTable invoices={items} />
    </div>
  );
}
