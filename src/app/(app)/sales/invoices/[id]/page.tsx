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
  quotations,
  deliveryNotes,
  stockReservations,
} from '@/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { InvoiceDetailClient } from './InvoiceDetailClient';

interface InvoicePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: InvoicePageProps): Promise<Metadata> {
  const { id } = await params;
  const [inv] = await db
    .select({ num: salesDocuments.documentNumber })
    .from(salesDocuments)
    .where(eq(salesDocuments.id, id));
  return {
    title: `Invoice ${inv?.num || 'Draft'} | Ace Holdings POS`,
  };
}

export default async function InvoiceDetailPage({ params }: InvoicePageProps) {
  try {
    await authorize(PERMISSIONS.INVOICES_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const { id } = await params;

  // 1. Fetch invoice header with customer, location, and user
  const [inv] = await db
    .select({
      id: salesDocuments.id,
      documentNumber: salesDocuments.documentNumber,
      documentType: salesDocuments.documentType,
      status: salesDocuments.status,
      deliveryStatus: salesDocuments.deliveryStatus,
      paymentStatus: salesDocuments.paymentStatus,
      issueDate: salesDocuments.issueDate,
      dueDate: salesDocuments.dueDate,
      currency: salesDocuments.currency,
      subtotalMinor: salesDocuments.subtotalMinor,
      discountMinor: salesDocuments.discountMinor,
      taxMinor: salesDocuments.taxMinor,
      totalMinor: salesDocuments.totalMinor,
      creditedMinor: salesDocuments.creditedMinor,
      paidMinor: salesDocuments.paidMinor,
      balanceMinor: salesDocuments.balanceMinor,
      notes: salesDocuments.notes,
      terms: salesDocuments.terms,
      isImmutable: salesDocuments.isImmutable,
      voidedAt: salesDocuments.voidedAt,
      voidReason: salesDocuments.voidReason,
      approvedAt: salesDocuments.approvedAt,
      approvalReason: salesDocuments.approvalReason,
      eisStatus: salesDocuments.eisStatus,
      createdAt: salesDocuments.createdAt,
      customerId: salesDocuments.customerId,
      customerName: customers.name,
      customerAccount: customers.accountNumber,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      customerTaxNumber: customers.taxNumber,
      customerCreditLimitMinor: customers.creditLimitMinor,
      customerIsWalkIn: customers.isWalkIn,
      locationId: salesDocuments.locationId,
      locationName: locations.name,
      locationCode: locations.code,
      createdByName: users.name,
      sourceQuotationId: salesDocuments.sourceQuotationId,
    })
    .from(salesDocuments)
    .innerJoin(customers, eq(salesDocuments.customerId, customers.id))
    .innerJoin(locations, eq(salesDocuments.locationId, locations.id))
    .leftJoin(users, eq(salesDocuments.createdBy, users.id))
    .where(and(eq(salesDocuments.id, id), eq(salesDocuments.documentType, 'invoice')));

  if (!inv) notFound();

  // 2. Fetch quotation if converted
  let sourceQuotation = null;
  if (inv.sourceQuotationId) {
    const [sq] = await db
      .select({
        id: quotations.id,
        quotationNumber: quotations.quotationNumber,
      })
      .from(quotations)
      .where(eq(quotations.id, inv.sourceQuotationId));
    sourceQuotation = sq || null;
  }

  // 3. Fetch lines
  const lines = await db
    .select({
      id: salesDocumentLines.id,
      sku: salesDocumentLines.sku,
      description: salesDocumentLines.description,
      quantity: salesDocumentLines.quantity,
      deliveredQty: salesDocumentLines.deliveredQty,
      creditedQty: salesDocumentLines.creditedQty,
      unitPriceMinor: salesDocumentLines.unitPriceMinor,
      discountMinor: salesDocumentLines.discountMinor,
      taxRateBasisPoints: salesDocumentLines.taxRateBasisPoints,
      taxMinor: salesDocumentLines.taxMinor,
      lineTotalMinor: salesDocumentLines.lineTotalMinor,
      notes: salesDocumentLines.notes,
      productName: products.name,
    })
    .from(salesDocumentLines)
    .innerJoin(products, eq(salesDocumentLines.productId, products.id))
    .where(eq(salesDocumentLines.documentId, id));

  // 4. Fetch related delivery notes
  const relatedDeliveryNotes = await db
    .select({
      id: deliveryNotes.id,
      deliveryNumber: deliveryNotes.deliveryNumber,
      deliveryDate: deliveryNotes.deliveryDate,
      status: deliveryNotes.status,
      receivedByCustomer: deliveryNotes.receivedByCustomer,
    })
    .from(deliveryNotes)
    .where(eq(deliveryNotes.salesDocumentId, id))
    .orderBy(desc(deliveryNotes.createdAt));

  // 5. Fetch related credit notes
  const relatedCreditNotes = await db
    .select({
      id: salesDocuments.id,
      documentNumber: salesDocuments.documentNumber,
      issueDate: salesDocuments.issueDate,
      totalMinor: salesDocuments.totalMinor,
      status: salesDocuments.status,
    })
    .from(salesDocuments)
    .where(
      and(
        eq(salesDocuments.sourceDocumentId, id),
        eq(salesDocuments.documentType, 'credit_note'),
      ),
    )
    .orderBy(desc(salesDocuments.createdAt));

  // 6. Fetch active reservations
  const reservations = await db
    .select({
      id: stockReservations.id,
      productName: products.name,
      sku: products.sku,
      reservedQty: stockReservations.reservedQty,
      status: stockReservations.status,
      expiresAt: stockReservations.expiresAt,
    })
    .from(stockReservations)
    .innerJoin(products, eq(stockReservations.productId, products.id))
    .where(
      and(
        eq(stockReservations.sourceDocumentType, 'sales_document'),
        eq(stockReservations.sourceDocumentId, id),
        eq(stockReservations.status, 'active'),
      ),
    );

  const formattedData = {
    id: inv.id,
    documentNumber: inv.documentNumber,
    status: inv.status as 'draft' | 'issued' | 'void',
    deliveryStatus: inv.deliveryStatus as 'not_delivered' | 'partly_delivered' | 'delivered',
    paymentStatus: inv.paymentStatus as 'unpaid' | 'partly_paid' | 'paid',
    issueDate: inv.issueDate ? new Date(inv.issueDate).toISOString() : '',
    dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString() : '',
    currency: inv.currency,
    subtotalMinor: inv.subtotalMinor,
    discountMinor: inv.discountMinor,
    taxMinor: inv.taxMinor,
    totalMinor: inv.totalMinor,
    creditedMinor: inv.creditedMinor,
    paidMinor: inv.paidMinor,
    balanceMinor: inv.balanceMinor,
    notes: inv.notes,
    terms: inv.terms,
    isImmutable: inv.isImmutable,
    voidedAt: inv.voidedAt ? inv.voidedAt.toISOString() : null,
    voidReason: inv.voidReason,
    approvedAt: inv.approvedAt ? inv.approvedAt.toISOString() : null,
    approvalReason: inv.approvalReason,
    eisStatus: inv.eisStatus,
    createdAt: inv.createdAt.toISOString(),
    customer: {
      id: inv.customerId,
      name: inv.customerName,
      accountNumber: inv.customerAccount,
      email: inv.customerEmail,
      phone: inv.customerPhone,
      taxNumber: inv.customerTaxNumber,
      creditLimitMinor: inv.customerCreditLimitMinor,
      isWalkIn: inv.customerIsWalkIn,
    },
    location: {
      id: inv.locationId,
      name: inv.locationName,
      code: inv.locationCode,
    },
    createdByUser: inv.createdByName ? { name: inv.createdByName } : null,
    sourceQuotation,
    lines: lines.map((l) => ({
      ...l,
      quantity: l.quantity.toString(),
      deliveredQty: l.deliveredQty.toString(),
      creditedQty: l.creditedQty.toString(),
    })),
    deliveryNotes: relatedDeliveryNotes.map((d) => ({
      ...d,
      deliveryDate: d.deliveryDate ? new Date(d.deliveryDate).toISOString() : '',
    })),
    creditNotes: relatedCreditNotes.map((c) => ({
      ...c,
      issueDate: c.issueDate ? new Date(c.issueDate).toISOString() : '',
    })),
    reservations: reservations.map((r) => ({
      ...r,
      reservedQty: r.reservedQty.toString(),
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    })),
  };

  return <InvoiceDetailClient invoice={formattedData} />;
}
