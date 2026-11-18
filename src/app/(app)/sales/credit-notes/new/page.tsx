import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import {
  salesDocuments,
  salesDocumentLines,
  customers,
  locations,
  products,
  deliveryNotes,
  deliveryNoteLines,
} from '@/server/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { CreditNoteForm, type InvoiceOptionForCredit } from './CreditNoteForm';

export const metadata: Metadata = {
  title: 'Issue Credit Note | Ace Holdings POS',
};

interface NewCreditNotePageProps {
  searchParams: Promise<{ invoiceId?: string }>;
}

export default async function NewCreditNotePage({ searchParams }: NewCreditNotePageProps) {
  try {
    await authorize(PERMISSIONS.CREDIT_NOTES_MANAGE);
  } catch {
    redirect('/dashboard');
  }

  const { invoiceId } = await searchParams;

  // 1. Fetch issued invoices
  const eligibleInvoices = await db
    .select({
      id: salesDocuments.id,
      documentNumber: salesDocuments.documentNumber,
      customerId: salesDocuments.customerId,
      customerName: customers.name,
      customerAccount: customers.accountNumber,
      locationId: salesDocuments.locationId,
      locationName: locations.name,
      issueDate: salesDocuments.issueDate,
      totalMinor: salesDocuments.totalMinor,
      balanceMinor: salesDocuments.balanceMinor,
      creditedMinor: salesDocuments.creditedMinor,
    })
    .from(salesDocuments)
    .innerJoin(customers, eq(salesDocuments.customerId, customers.id))
    .innerJoin(locations, eq(salesDocuments.locationId, locations.id))
    .where(
      and(
        eq(salesDocuments.documentType, 'invoice'),
        eq(salesDocuments.status, 'issued'),
      ),
    )
    .orderBy(desc(salesDocuments.issueDate));

  if (eligibleInvoices.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sales/credit-notes">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to Credit Notes
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ace-navy">Issue Credit Note</h1>
            <p className="text-sm text-muted-foreground">
              No issued invoices currently exist to credit.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const invoiceIds = eligibleInvoices.map((i) => i.id);

  // 2. Fetch invoice lines
  const allLines = await db
    .select({
      id: salesDocumentLines.id,
      documentId: salesDocumentLines.documentId,
      productId: salesDocumentLines.productId,
      productName: products.name,
      sku: salesDocumentLines.sku,
      quantity: salesDocumentLines.quantity,
      deliveredQty: salesDocumentLines.deliveredQty,
      creditedQty: salesDocumentLines.creditedQty,
      unitPriceMinor: salesDocumentLines.unitPriceMinor,
      discountMinor: salesDocumentLines.discountMinor,
      taxRateBasisPoints: salesDocumentLines.taxRateBasisPoints,
      isSerialized: products.serialTracking,
    })
    .from(salesDocumentLines)
    .innerJoin(products, eq(salesDocumentLines.productId, products.id))
    .where(inArray(salesDocumentLines.documentId, invoiceIds));

  // 3. Fetch delivered serial numbers across these invoices from deliveryNoteLines
  const deliveredSerialsRows = await db
    .select({
      salesDocumentId: deliveryNotes.salesDocumentId,
      salesDocumentLineId: deliveryNoteLines.salesDocumentLineId,
      serialNumbers: deliveryNoteLines.serialNumbers,
    })
    .from(deliveryNoteLines)
    .innerJoin(deliveryNotes, eq(deliveryNoteLines.deliveryNoteId, deliveryNotes.id))
    .where(inArray(deliveryNotes.salesDocumentId, invoiceIds));

  // Map: salesDocumentLineId -> set of serial strings
  const deliveredSerialsMap = new Map<string, string[]>();
  for (const row of deliveredSerialsRows) {
    if (row.serialNumbers && row.serialNumbers.length > 0) {
      const list = deliveredSerialsMap.get(row.salesDocumentLineId) || [];
      for (const s of row.serialNumbers) {
        if (!list.includes(s)) list.push(s);
      }
      deliveredSerialsMap.set(row.salesDocumentLineId, list);
    }
  }

  // Assemble full formatted options
  const formattedInvoices: InvoiceOptionForCredit[] = eligibleInvoices.map((inv) => {
    const linesForInv = allLines.filter((l) => l.documentId === inv.id);

    return {
      id: inv.id,
      documentNumber: inv.documentNumber,
      customerName: inv.customerName,
      customerAccount: inv.customerAccount,
      locationName: inv.locationName,
      issueDate: inv.issueDate ? new Date(inv.issueDate).toISOString() : '',
      totalMinor: inv.totalMinor,
      balanceMinor: inv.balanceMinor,
      creditedMinor: inv.creditedMinor,
      lines: linesForInv.map((l) => ({
        id: l.id,
        productId: l.productId,
        productName: l.productName,
        sku: l.sku,
        quantity: l.quantity.toString(),
        deliveredQty: l.deliveredQty.toString(),
        creditedQty: l.creditedQty.toString(),
        unitPriceMinor: l.unitPriceMinor,
        discountMinor: l.discountMinor,
        taxRateBasisPoints: l.taxRateBasisPoints,
        isSerialized: l.isSerialized,
        deliveredSerials: deliveredSerialsMap.get(l.id) || [],
      })),
    };
  });

  return (
    <div className="space-y-6">
      <CreditNoteForm
        invoices={formattedInvoices}
        preselectedInvoiceId={invoiceId}
      />
    </div>
  );
}
