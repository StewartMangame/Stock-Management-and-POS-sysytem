import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { listCategories } from '@/server/services/stock/categories';
import { listUnitsOfMeasure } from '@/server/services/stock/uom';
import { listProducts } from '@/server/services/stock/products';
import { db } from '@/server/db';
import { taxRates } from '@/server/db/schema';
import { asc } from 'drizzle-orm';
import { Button } from '@/components/ui/button';
import { ProductForm } from '../ProductForm';

export const metadata: Metadata = { title: 'New Product | Ace Holdings POS' };

export default async function NewProductPage() {
  try {
    await authorize(PERMISSIONS.PRODUCTS_MANAGE);
  } catch {
    redirect('/dashboard');
  }

  const [categories, uoms, allTaxRates, allProducts] = await Promise.all([
    listCategories(),
    listUnitsOfMeasure(),
    db.select().from(taxRates).orderBy(asc(taxRates.name)),
    listProducts(),
  ]);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Link href="/stock/products">
          <Button variant="ghost" size="sm">← Back</Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">New Product</h1>
          <p className="text-sm text-ace-muted">Register a standard product, bundle, or service item.</p>
        </div>
      </div>

      <ProductForm
        categories={categories}
        uoms={uoms}
        taxRates={allTaxRates}
        allProducts={allProducts}
        isEditing={false}
      />
    </div>
  );
}
