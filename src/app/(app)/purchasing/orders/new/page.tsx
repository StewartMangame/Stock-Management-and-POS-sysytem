import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { suppliers, locations, products } from '@/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { POForm } from '../POForm';

export const metadata: Metadata = { title: 'New Purchase Order | Ace Holdings POS' };

export default async function NewPurchaseOrderPage() {
  try {
    await authorize(PERMISSIONS.PURCHASE_ORDERS_MANAGE);
  } catch {
    redirect('/dashboard');
  }

  const [allSuppliers, allLocations, allProducts] = await Promise.all([
    db.query.suppliers.findMany({
      where: eq(suppliers.isActive, true),
      orderBy: [desc(suppliers.createdAt)],
    }),
    db.query.locations.findMany({
      where: eq(locations.isActive, true),
      orderBy: [locations.name],
    }),
    db.query.products.findMany({
      where: eq(products.isActive, true),
      orderBy: [products.name],
    }),
  ]);

  return (
    <div className="max-w-6xl mx-auto">
      <POForm
        suppliers={allSuppliers.map((s) => ({
          id: s.id,
          name: s.name,
          code: s.code,
          defaultCurrency: s.defaultCurrency,
        }))}
        locations={allLocations.map((l) => ({
          id: l.id,
          name: l.name,
          type: l.type,
        }))}
        products={allProducts
          .filter((p) => p.productType !== 'service')
          .map((p) => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            lastCostMinor: Number(p.lastCostMinor),
          }))}
      />
    </div>
  );
}
