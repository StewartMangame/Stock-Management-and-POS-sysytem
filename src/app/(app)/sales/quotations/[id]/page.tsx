import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import {
  quotations,
  quotationLines,
  customers,
  locations,
  users,
  products,
  stockReservations,
} from '@/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { QuotationDetailClient } from './QuotationDetailClient';

interface QuotationPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: QuotationPageProps): Promise<Metadata> {
  const { id } = await params;
  const [q] = await db
    .select({ num: quotations.quotationNumber })
    .from(quotations)
    .where(eq(quotations.id, id));
  return {
    title: `Quotation ${q?.num || 'Draft'} | Ace Holdings POS`,
  };
}

export default async function QuotationDetailPage({ params }: QuotationPageProps) {
  try {
    await authorize(PERMISSIONS.QUOTATIONS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const { id } = await params;

  // 1. Fetch quotation with customer, location, and user
  const [q] = await db
    .select({
      id: quotations.id,
      quotationNumber: quotations.quotationNumber,
      status: quotations.status,
      quotationDate: quotations.quotationDate,
      validUntil: quotations.validUntil,
      currency: quotations.currency,
      subtotalMinor: quotations.subtotalMinor,
      discountMinor: quotations.discountMinor,
      taxMinor: quotations.taxMinor,
      totalMinor: quotations.totalMinor,
      notes: quotations.notes,
      terms: quotations.terms,
      createdAt: quotations.createdAt,
      customerId: quotations.customerId,
      customerName: customers.name,
      customerAccount: customers.accountNumber,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      customerAddress: customers.address,
      customerTaxNumber: customers.taxNumber,
      customerCreditLimitMinor: customers.creditLimitMinor,
      locationId: quotations.locationId,
      locationName: locations.name,
      locationCode: locations.code,
      createdByName: users.name,
    })
    .from(quotations)
    .innerJoin(customers, eq(quotations.customerId, customers.id))
    .innerJoin(locations, eq(quotations.locationId, locations.id))
    .leftJoin(users, eq(quotations.createdBy, users.id))
    .where(eq(quotations.id, id));

  if (!q) notFound();

  // 2. Fetch lines
  const lines = await db
    .select({
      id: quotationLines.id,
      sku: quotationLines.sku,
      description: quotationLines.description,
      quantity: quotationLines.quantity,
      unitPriceMinor: quotationLines.unitPriceMinor,
      discountMinor: quotationLines.discountMinor,
      taxRateBasisPoints: quotationLines.taxRateBasisPoints,
      taxMinor: quotationLines.taxMinor,
      lineTotalMinor: quotationLines.lineTotalMinor,
      notes: quotationLines.notes,
      productName: products.name,
    })
    .from(quotationLines)
    .innerJoin(products, eq(quotationLines.productId, products.id))
    .where(eq(quotationLines.quotationId, id));

  // 3. Fetch active reservations (if any)
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
        eq(stockReservations.sourceDocumentType, 'quotation'),
        eq(stockReservations.sourceDocumentId, id),
        eq(stockReservations.status, 'active'),
      ),
    );

  const formattedData = {
    id: q.id,
    quotationNumber: q.quotationNumber,
    status: q.status,
    quotationDate: q.quotationDate ? new Date(q.quotationDate).toISOString() : '',
    validUntil: q.validUntil ? new Date(q.validUntil).toISOString() : '',
    currency: q.currency,
    subtotalMinor: q.subtotalMinor,
    discountMinor: q.discountMinor,
    taxMinor: q.taxMinor,
    totalMinor: q.totalMinor,
    notes: q.notes,
    terms: q.terms,
    createdAt: q.createdAt.toISOString(),
    customer: {
      id: q.customerId,
      name: q.customerName,
      accountNumber: q.customerAccount,
      address: q.customerAddress,
      email: q.customerEmail,
      phone: q.customerPhone,
      taxNumber: q.customerTaxNumber,
      creditLimitMinor: q.customerCreditLimitMinor,
    },
    location: {
      id: q.locationId,
      name: q.locationName,
      code: q.locationCode,
    },
    createdByUser: q.createdByName ? { id: '', name: q.createdByName } : null,
    lines: lines.map((l) => ({
      ...l,
      quantity: l.quantity.toString(),
    })),
    reservations: reservations.map((r) => ({
      ...r,
      reservedQty: r.reservedQty.toString(),
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    })),
  };

  return <QuotationDetailClient quotation={formattedData} />;
}
