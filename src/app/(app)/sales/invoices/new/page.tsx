import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { customers, products, locations, taxRates } from '@/server/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { InvoiceForm } from './InvoiceForm';

export const metadata: Metadata = {
  title: 'New Direct Invoice | Ace Holdings POS',
};

export default async function NewInvoicePage() {
  try {
    await authorize(PERMISSIONS.INVOICES_MANAGE);
  } catch {
    redirect('/dashboard');
  }

  // 1. Fetch active customers
  const customerRows = await db
    .select({
      id: customers.id,
      name: customers.name,
      accountNumber: customers.accountNumber,
      isWalkIn: customers.isWalkIn,
      creditLimitMinor: customers.creditLimitMinor,
      paymentTermsDays: customers.paymentTermsDays,
    })
    .from(customers)
    .where(eq(customers.isActive, true))
    .orderBy(asc(customers.name));

  // 2. Fetch active products with tax rates
  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      sellingPriceMinor: products.sellingPriceMinor,
      avgCostMinor: products.avgCostMinor,
      taxRateId: products.taxRateId,
      taxBasisPoints: taxRates.rateBasisPoints,
    })
    .from(products)
    .leftJoin(taxRates, eq(products.taxRateId, taxRates.id))
    .where(eq(products.isActive, true))
    .orderBy(asc(products.name));

  // 3. Fetch active locations
  const locationRows = await db
    .select({
      id: locations.id,
      name: locations.name,
    })
    .from(locations)
    .where(eq(locations.isActive, true))
    .orderBy(asc(locations.name));

  // 4. Default tax rate
  const [defaultTax] = await db
    .select({ id: taxRates.id })
    .from(taxRates)
    .where(and(eq(taxRates.isDefault, true), eq(taxRates.isActive, true)));

  const productOptions = productRows.map((p) => ({
    ...p,
    taxBasisPoints: p.taxBasisPoints ?? undefined,
  }));

  return (
    <div className="space-y-6">
      <InvoiceForm
        customers={customerRows}
        products={productOptions}
        locations={locationRows}
        defaultTaxRateId={defaultTax?.id || ''}
      />
    </div>
  );
}
