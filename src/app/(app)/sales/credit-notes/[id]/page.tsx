import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import {
  salesDocuments,
  salesDocumentLines,
  customers,
  locations,
  users,
  products,
} from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { CreditNoteDetailClient } from './CreditNoteDetailClient';

interface CreditNotePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: CreditNotePageProps): Promise<Metadata> {
  const { id } = await params;
  const [cn] = await db
    .select({ num: salesDocuments.documentNumber })
    .from(salesDocuments)
    .where(eq(salesDocuments.id, id));
  return {
    title: `Credit Note ${cn?.num || ''} | Ace Holdings POS`,
  };
}

export default async function CreditNoteDetailPage({ params }: CreditNotePageProps) {
  try {
    await authorize(PERMISSIONS.INVOICES_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const { id } = await params;

  const parentInvoices = alias(salesDocuments, 'parent_invoices');

  // 1. Fetch credit note header
  const [cn] = await db
    .select({
      id: salesDocuments.id,
      documentNumber: salesDocuments.documentNumber,
      issueDate: salesDocuments.issueDate,
      status: salesDocuments.status,
      subtotalMinor: salesDocuments.subtotalMinor,
      discountMinor: salesDocuments.discountMinor,
      taxMinor: salesDocuments.taxMinor,
      totalMinor: salesDocuments.totalMinor,
      notes: salesDocuments.notes,
      terms: salesDocuments.terms,
      createdAt: salesDocuments.createdAt,
      sourceInvoiceId: salesDocuments.sourceDocumentId,
      sourceInvoiceNumber: parentInvoices.documentNumber,
      customerId: salesDocuments.customerId,
      customerName: customers.name,
      customerAccount: customers.accountNumber,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      customerTaxNumber: customers.taxNumber,
      locationId: salesDocuments.locationId,
      locationName: locations.name,
      locationCode: locations.code,
      createdByName: users.name,
    })
    .from(salesDocuments)
    .innerJoin(customers, eq(salesDocuments.customerId, customers.id))
    .innerJoin(locations, eq(salesDocuments.locationId, locations.id))
    .leftJoin(parentInvoices, eq(salesDocuments.sourceDocumentId, parentInvoices.id))
    .leftJoin(users, eq(salesDocuments.createdBy, users.id))
    .where(
      and(
        eq(salesDocuments.id, id),
        eq(salesDocuments.documentType, 'credit_note'),
      ),
    );

  if (!cn) notFound();

  // 2. Fetch lines
  const lines = await db
    .select({
      id: salesDocumentLines.id,
      productId: salesDocumentLines.productId,
      productName: products.name,
      sku: salesDocumentLines.sku,
      quantity: salesDocumentLines.quantity,
      unitPriceMinor: salesDocumentLines.unitPriceMinor,
      discountMinor: salesDocumentLines.discountMinor,
      taxRateBasisPoints: salesDocumentLines.taxRateBasisPoints,
      taxMinor: salesDocumentLines.taxMinor,
      lineTotalMinor: salesDocumentLines.lineTotalMinor,
      returnGoods: salesDocumentLines.returnGoods,
      notes: salesDocumentLines.notes,
    })
    .from(salesDocumentLines)
    .innerJoin(products, eq(salesDocumentLines.productId, products.id))
    .where(eq(salesDocumentLines.documentId, id));

  const formattedData = {
    id: cn.id,
    documentNumber: cn.documentNumber,
    issueDate: cn.issueDate ? new Date(cn.issueDate).toISOString() : '',
    status: cn.status,
    subtotalMinor: cn.subtotalMinor,
    discountMinor: cn.discountMinor,
    taxMinor: cn.taxMinor,
    totalMinor: cn.totalMinor,
    notes: cn.notes,
    terms: cn.terms,
    createdAt: cn.createdAt.toISOString(),
    sourceInvoice: cn.sourceInvoiceId
      ? {
          id: cn.sourceInvoiceId,
          documentNumber: cn.sourceInvoiceNumber,
        }
      : null,
    customer: {
      id: cn.customerId,
      name: cn.customerName,
      accountNumber: cn.customerAccount,
      email: cn.customerEmail,
      phone: cn.customerPhone,
      taxNumber: cn.customerTaxNumber,
    },
    location: {
      id: cn.locationId,
      name: cn.locationName,
      code: cn.locationCode,
    },
    createdByUser: cn.createdByName ? { name: cn.createdByName } : null,
    lines: lines.map((l) => ({
      ...l,
      quantity: l.quantity.toString(),
    })),
  };

  return <CreditNoteDetailClient creditNote={formattedData} />;
}
