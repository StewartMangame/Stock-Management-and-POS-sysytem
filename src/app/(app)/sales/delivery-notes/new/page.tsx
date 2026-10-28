import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import {
  salesDocuments,
  salesDocumentLines,
  customers,
  locations,
  products,
  productBundles,
  serialNumbers,
} from '@/server/db/schema';
import { eq, and, ne, desc, inArray } from 'drizzle-orm';
import { DeliveryNoteForm, type InvoiceOption } from './DeliveryNoteForm';

export const metadata: Metadata = {
  title: 'Dispatch Delivery Note | Ace Holdings POS',
};

interface NewDeliveryNotePageProps {
  searchParams: Promise<{ invoiceId?: string }>;
}

export default async function NewDeliveryNotePage({ searchParams }: NewDeliveryNotePageProps) {
  try {
    await authorize(PERMISSIONS.DELIVERY_NOTES_MANAGE);
  } catch {
    redirect('/dashboard');
  }

  const { invoiceId } = await searchParams;

  // 1. Fetch issued invoices that have not been completely delivered
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
    })
    .from(salesDocuments)
    .innerJoin(customers, eq(salesDocuments.customerId, customers.id))
    .innerJoin(locations, eq(salesDocuments.locationId, locations.id))
    .where(
      and(
        eq(salesDocuments.documentType, 'invoice'),
        eq(salesDocuments.status, 'issued'),
        ne(salesDocuments.deliveryStatus, 'delivered'),
      ),
    )
    .orderBy(desc(salesDocuments.issueDate));

  if (eligibleInvoices.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ace-navy">Dispatch Delivery Note</h1>
          <p className="text-sm text-muted-foreground">
            No issued invoices currently require delivery fulfillment.
          </p>
        </div>
      </div>
    );
  }

  const invoiceIds = eligibleInvoices.map((i) => i.id);

  // 2. Fetch lines for all eligible invoices
  const allLines = await db
    .select({
      id: salesDocumentLines.id,
      documentId: salesDocumentLines.documentId,
      productId: salesDocumentLines.productId,
      productName: products.name,
      sku: salesDocumentLines.sku,
      quantity: salesDocumentLines.quantity,
      deliveredQty: salesDocumentLines.deliveredQty,
      isSerialized: products.serialTracking,
      productType: products.productType,
      locationId: salesDocuments.locationId,
    })
    .from(salesDocumentLines)
    .innerJoin(salesDocuments, eq(salesDocumentLines.documentId, salesDocuments.id))
    .innerJoin(products, eq(salesDocumentLines.productId, products.id))
    .where(inArray(salesDocumentLines.documentId, invoiceIds));

  // 3. Collect product IDs to fetch serial numbers and bundle components
  const productIds = Array.from(new Set(allLines.map((l) => l.productId)));
  const bundleProductIds = allLines
    .filter((l) => l.productType === 'bundle')
    .map((l) => l.productId);

  // Bundle components
  let bundleComponentsMap = new Map<
    string,
    Array<{
      componentProductId: string;
      componentProductName: string;
      quantityPerBundle: string;
      isSerialized: boolean;
    }>
  >();

  const componentProductIds = new Set<string>();

  if (bundleProductIds.length > 0) {
    const rawComponents = await db
      .select({
        bundleProductId: productBundles.bundleProductId,
        componentProductId: productBundles.componentProductId,
        componentProductName: products.name,
        quantityPerBundle: productBundles.quantity,
        isSerialized: products.serialTracking,
      })
      .from(productBundles)
      .innerJoin(products, eq(productBundles.componentProductId, products.id))
      .where(inArray(productBundles.bundleProductId, bundleProductIds));

    for (const c of rawComponents) {
      const list = bundleComponentsMap.get(c.bundleProductId) || [];
      list.push(c);
      bundleComponentsMap.set(c.bundleProductId, list);
      componentProductIds.add(c.componentProductId);
    }
  }

  // 4. Fetch available in_stock serials for all relevant products across locations
  const allRelevantProductIds = Array.from(new Set([...productIds, ...Array.from(componentProductIds)]));
  const locationIds = Array.from(new Set(eligibleInvoices.map((i) => i.locationId)));

  const availableSerialsRows =
    allRelevantProductIds.length > 0 && locationIds.length > 0
      ? await db
          .select({
            productId: serialNumbers.productId,
            locationId: serialNumbers.locationId,
            serialNumber: serialNumbers.serialNumber,
          })
          .from(serialNumbers)
          .where(
            and(
              inArray(serialNumbers.productId, allRelevantProductIds),
              inArray(serialNumbers.locationId, locationIds),
              eq(serialNumbers.status, 'in_stock'),
            ),
          )
      : [];

  // Group serials by "productId_locationId"
  const serialMap = new Map<string, string[]>();
  for (const s of availableSerialsRows) {
    const key = `${s.productId}_${s.locationId}`;
    const list = serialMap.get(key) || [];
    list.push(s.serialNumber);
    serialMap.set(key, list);
  }

  // Assemble full invoice options
  const formattedInvoices: InvoiceOption[] = eligibleInvoices.map((inv) => {
    const linesForInv = allLines.filter((l) => l.documentId === inv.id);

    return {
      id: inv.id,
      documentNumber: inv.documentNumber,
      customerName: inv.customerName,
      customerAccount: inv.customerAccount,
      locationName: inv.locationName,
      locationId: inv.locationId,
      issueDate: inv.issueDate ? new Date(inv.issueDate).toISOString() : '',
      lines: linesForInv.map((l) => {
        const availableSerials = serialMap.get(`${l.productId}_${inv.locationId}`) || [];

        const components = bundleComponentsMap.get(l.productId)?.map((comp) => ({
          componentProductId: comp.componentProductId,
          componentProductName: comp.componentProductName,
          quantityPerBundle: comp.quantityPerBundle,
          isSerialized: comp.isSerialized,
          availableSerials: serialMap.get(`${comp.componentProductId}_${inv.locationId}`) || [],
        }));

        return {
          id: l.id,
          productId: l.productId,
          productName: l.productName,
          sku: l.sku,
          quantity: l.quantity.toString(),
          deliveredQty: l.deliveredQty.toString(),
          isSerialized: l.isSerialized,
          productType: l.productType,
          availableSerials,
          bundleComponents: components,
        };
      }),
    };
  });

  return (
    <div className="space-y-6">
      <DeliveryNoteForm
        invoices={formattedInvoices}
        preselectedInvoiceId={invoiceId}
      />
    </div>
  );
}
