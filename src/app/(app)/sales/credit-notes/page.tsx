import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { salesDocuments, customers, salesDocumentLines } from '@/server/db/schema';
import { eq, desc, sql, and } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { CreditNotesTable, type CreditNoteListItem } from './CreditNotesTable';

export const metadata: Metadata = {
  title: 'Credit Notes | Ace Holdings POS',
};

export default async function CreditNotesPage() {
  try {
    await authorize(PERMISSIONS.INVOICES_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const parentInvoices = alias(salesDocuments, 'parent_invoices');

  const rows = await db
    .select({
      id: salesDocuments.id,
      documentNumber: salesDocuments.documentNumber,
      sourceInvoiceId: salesDocuments.sourceDocumentId,
      sourceInvoiceNumber: parentInvoices.documentNumber,
      customerName: customers.name,
      customerAccount: customers.accountNumber,
      issueDate: salesDocuments.issueDate,
      status: salesDocuments.status,
      totalMinor: salesDocuments.totalMinor,
      linesCount: sql<string>`count(${salesDocumentLines.id})`,
    })
    .from(salesDocuments)
    .innerJoin(customers, eq(salesDocuments.customerId, customers.id))
    .leftJoin(parentInvoices, eq(salesDocuments.sourceDocumentId, parentInvoices.id))
    .leftJoin(salesDocumentLines, eq(salesDocuments.id, salesDocumentLines.documentId))
    .where(eq(salesDocuments.documentType, 'credit_note'))
    .groupBy(
      salesDocuments.id,
      salesDocuments.documentNumber,
      salesDocuments.sourceDocumentId,
      parentInvoices.documentNumber,
      customers.name,
      customers.accountNumber,
      salesDocuments.issueDate,
      salesDocuments.status,
      salesDocuments.totalMinor,
      salesDocuments.createdAt,
    )
    .orderBy(desc(salesDocuments.createdAt));

  const items: CreditNoteListItem[] = rows.map((r) => ({
    id: r.id,
    documentNumber: r.documentNumber,
    sourceInvoiceId: r.sourceInvoiceId,
    sourceInvoiceNumber: r.sourceInvoiceNumber,
    customerName: r.customerName,
    customerAccount: r.customerAccount,
    issueDate: r.issueDate ? new Date(r.issueDate).toISOString() : '',
    status: r.status,
    totalMinor: r.totalMinor,
    linesCount: parseInt(r.linesCount || '0', 10),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ace-navy">Credit Notes</h1>
        <p className="text-sm text-muted-foreground">
          Issue credit notes against sales invoices, handle customer returns into inventory, and release undelivered stock reservations.
        </p>
      </div>

      <CreditNotesTable creditNotes={items} />
    </div>
  );
}
