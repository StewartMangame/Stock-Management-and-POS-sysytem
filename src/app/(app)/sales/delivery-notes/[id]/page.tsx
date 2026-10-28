import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import {
  deliveryNotes,
  deliveryNoteLines,
  salesDocuments,
  customers,
  locations,
  users,
  products,
} from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { DeliveryNoteDetailClient } from './DeliveryNoteDetailClient';

interface DeliveryNotePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: DeliveryNotePageProps): Promise<Metadata> {
  const { id } = await params;
  const [dn] = await db
    .select({ num: deliveryNotes.deliveryNumber })
    .from(deliveryNotes)
    .where(eq(deliveryNotes.id, id));
  return {
    title: `Delivery Note ${dn?.num || ''} | Ace Holdings POS`,
  };
}

export default async function DeliveryNoteDetailPage({ params }: DeliveryNotePageProps) {
  try {
    await authorize(PERMISSIONS.STOCK_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const { id } = await params;

  // 1. Fetch delivery note header
  const [dn] = await db
    .select({
      id: deliveryNotes.id,
      deliveryNumber: deliveryNotes.deliveryNumber,
      deliveryDate: deliveryNotes.deliveryDate,
      status: deliveryNotes.status,
      notes: deliveryNotes.notes,
      receivedByCustomer: deliveryNotes.receivedByCustomer,
      createdAt: deliveryNotes.createdAt,
      salesDocumentId: deliveryNotes.salesDocumentId,
      invoiceNumber: salesDocuments.documentNumber,
      customerId: deliveryNotes.customerId,
      customerName: customers.name,
      customerAccount: customers.accountNumber,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      customerTaxNumber: customers.taxNumber,
      locationId: deliveryNotes.locationId,
      locationName: locations.name,
      locationCode: locations.code,
      createdByName: users.name,
    })
    .from(deliveryNotes)
    .innerJoin(salesDocuments, eq(deliveryNotes.salesDocumentId, salesDocuments.id))
    .innerJoin(customers, eq(deliveryNotes.customerId, customers.id))
    .innerJoin(locations, eq(deliveryNotes.locationId, locations.id))
    .leftJoin(users, eq(deliveryNotes.createdBy, users.id))
    .where(eq(deliveryNotes.id, id));

  if (!dn) notFound();

  // 2. Fetch lines
  const lines = await db
    .select({
      id: deliveryNoteLines.id,
      productId: deliveryNoteLines.productId,
      productName: products.name,
      sku: products.sku,
      quantity: deliveryNoteLines.quantity,
      isBundleComponent: deliveryNoteLines.isBundleComponent,
      serialNumbers: deliveryNoteLines.serialNumbers,
    })
    .from(deliveryNoteLines)
    .innerJoin(products, eq(deliveryNoteLines.productId, products.id))
    .where(eq(deliveryNoteLines.deliveryNoteId, id));

  const formattedData = {
    id: dn.id,
    deliveryNumber: dn.deliveryNumber,
    deliveryDate: dn.deliveryDate ? new Date(dn.deliveryDate).toISOString() : '',
    status: dn.status,
    notes: dn.notes,
    receivedByCustomer: dn.receivedByCustomer,
    createdAt: dn.createdAt.toISOString(),
    invoice: {
      id: dn.salesDocumentId,
      documentNumber: dn.invoiceNumber,
    },
    customer: {
      id: dn.customerId,
      name: dn.customerName,
      accountNumber: dn.customerAccount,
      email: dn.customerEmail,
      phone: dn.customerPhone,
      taxNumber: dn.customerTaxNumber,
    },
    location: {
      id: dn.locationId,
      name: dn.locationName,
      code: dn.locationCode,
    },
    createdByUser: dn.createdByName ? { name: dn.createdByName } : null,
    lines: lines.map((l) => ({
      ...l,
      quantity: l.quantity.toString(),
      serialNumbers: l.serialNumbers || [],
    })),
  };

  return <DeliveryNoteDetailClient deliveryNote={formattedData} />;
}
