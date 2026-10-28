import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { deliveryNotes, salesDocuments, customers, deliveryNoteLines } from '@/server/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { DeliveryNotesTable, type DeliveryNoteListItem } from './DeliveryNotesTable';

export const metadata: Metadata = {
  title: 'Delivery Notes | Ace Holdings POS',
};

export default async function DeliveryNotesPage() {
  try {
    await authorize(PERMISSIONS.STOCK_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const rows = await db
    .select({
      id: deliveryNotes.id,
      deliveryNumber: deliveryNotes.deliveryNumber,
      salesDocumentId: deliveryNotes.salesDocumentId,
      invoiceNumber: salesDocuments.documentNumber,
      customerName: customers.name,
      customerAccount: customers.accountNumber,
      deliveryDate: deliveryNotes.deliveryDate,
      status: deliveryNotes.status,
      receivedByCustomer: deliveryNotes.receivedByCustomer,
      itemsCount: sql<string>`count(${deliveryNoteLines.id})`,
    })
    .from(deliveryNotes)
    .innerJoin(salesDocuments, eq(deliveryNotes.salesDocumentId, salesDocuments.id))
    .innerJoin(customers, eq(deliveryNotes.customerId, customers.id))
    .leftJoin(deliveryNoteLines, eq(deliveryNotes.id, deliveryNoteLines.deliveryNoteId))
    .groupBy(
      deliveryNotes.id,
      deliveryNotes.deliveryNumber,
      deliveryNotes.salesDocumentId,
      salesDocuments.documentNumber,
      customers.name,
      customers.accountNumber,
      deliveryNotes.deliveryDate,
      deliveryNotes.status,
      deliveryNotes.receivedByCustomer,
      deliveryNotes.createdAt,
    )
    .orderBy(desc(deliveryNotes.createdAt));

  const items: DeliveryNoteListItem[] = rows.map((r) => ({
    id: r.id,
    deliveryNumber: r.deliveryNumber,
    salesDocumentId: r.salesDocumentId,
    invoiceNumber: r.invoiceNumber,
    customerName: r.customerName,
    customerAccount: r.customerAccount,
    deliveryDate: r.deliveryDate ? new Date(r.deliveryDate).toISOString() : '',
    status: r.status,
    receivedByCustomer: r.receivedByCustomer,
    itemsCount: parseInt(r.itemsCount || '0', 10),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ace-navy">Delivery Notes</h1>
        <p className="text-sm text-muted-foreground">
          Track warehouse goods dispatch, record serial numbers with automated warranty activation, and fulfill stock reservations.
        </p>
      </div>

      <DeliveryNotesTable deliveryNotes={items} />
    </div>
  );
}
