import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { customers, products, locations, taxRates } from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { QuotationForm } from './QuotationForm';

export const metadata: Metadata = {
  title: 'New Quotation | Ace Holdings POS',
};

export default async function NewQuotationPage() {
  try {
    await authorize(PERMISSIONS.QUOTATIONS_MANAGE);
  } catch {
    redirect('/sales/quotations');
  }

  const activeCustomers = await db
    .select({
      id: customers.id,
      name: customers.name,
      accountNumber: customers.accountNumber,
      isWalkIn: customers.isWalkIn,
      creditLimitMinor: customers.creditLimitMinor,
    })
    .from(customers)
    .where(eq(customers.isActive, true))
    .orderBy(customers.name);

  const activeProducts = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      sellingPriceMinor: products.sellingPriceMinor,
      taxRateId: products.taxRateId,
    })
    .from(products)
    .where(eq(products.isActive, true))
    .orderBy(products.name);

  const locs = await db
    .select({
      id: locations.id,
      name: locations.name,
    })
    .from(locations)
    .orderBy(locations.name);

  const [defaultTax] = await db
    .select()
    .from(taxRates)
    .where(and(eq(taxRates.isDefault, true), eq(taxRates.isActive, true)));

  return (
    <QuotationForm
      customers={activeCustomers}
      products={activeProducts}
      locations={locs}
      defaultTaxRateId={defaultTax?.id || ''}
    />
  );
}
