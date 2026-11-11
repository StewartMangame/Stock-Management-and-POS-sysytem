import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { listCategories } from '@/server/services/stock/categories';
import { listUnitsOfMeasure } from '@/server/services/stock/uom';
import { listProducts } from '@/server/services/stock/products';
import { db } from '@/server/db';
import { taxRates, locations } from '@/server/db/schema';
import { asc, eq } from 'drizzle-orm';
import { Button } from '@/components/ui/button';
import { ProductForm } from '../ProductForm';

export const metadata: Metadata = { title: 'New Product | Ace Holdings POS' };

export default async function NewProductPage() {
  try {
    await authorize(PERMISSIONS.PRODUCTS_MANAGE);
  } catch {
    redirect('/dashboard');
  }

  const [categories, uoms, allTaxRates, allProducts, allLocations] = await Promise.all([
    listCategories(),
    listUnitsOfMeasure(),
    db.select().from(taxRates).orderBy(asc(taxRates.name)),
    listProducts(),
    db
      .select({ id: locations.id, name: locations.name, code: locations.code })
      .from(locations)
      .where(eq(locations.isActive, true))
      .orderBy(asc(locations.name)),
  ]);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/stock/products">
          <Button variant="ghost" size="sm">← Back</Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">New Product</h1>
          <p className="text-sm text-ace-muted">Register an inventory product, non-inventory item, or service.</p>
        </div>
      </div>

      <ProductForm
        categories={categories}
        uoms={uoms}
        taxRates={allTaxRates}
        allProducts={allProducts}
        locations={allLocations}
        isEditing={false}
      />
    </div>
  );
}
