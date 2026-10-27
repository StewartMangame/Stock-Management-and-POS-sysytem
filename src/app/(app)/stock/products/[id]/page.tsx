import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getProductById } from '@/server/services/stock/products';
import { listCategories } from '@/server/services/stock/categories';
import { listUnitsOfMeasure } from '@/server/services/stock/uom';
import { listProducts } from '@/server/services/stock/products';
import { db } from '@/server/db';
import { taxRates } from '@/server/db/schema';
import { asc } from 'drizzle-orm';
import { formatMwk } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProductForm } from '../ProductForm';

export const metadata: Metadata = { title: 'Edit Product | Ace Holdings POS' };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(PERMISSIONS.PRODUCTS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const { id } = await params;
  const [product, categories, uoms, allTaxRates, allProducts] = await Promise.all([
    getProductById(id),
    listCategories(),
    listUnitsOfMeasure(),
    db.select().from(taxRates).orderBy(asc(taxRates.name)),
    listProducts(),
  ]);

  if (!product) notFound();

  const totalOnHand = product.stockBalances.reduce((s, b) => s + parseFloat(b.onHand ?? '0'), 0);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Link href="/stock/products">
          <Button variant="ghost" size="sm">← Back</Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">{product.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <code className="text-xs font-mono bg-gray-100 rounded px-1.5 py-0.5">{product.sku}</code>
            <Badge variant="outline" className="capitalize text-xs">{product.productType}</Badge>
            <Badge variant={product.isActive ? 'outline' : 'destructive'}
              className={product.isActive ? 'border-emerald-500 text-emerald-700 bg-emerald-50 text-xs' : 'text-xs'}>
              {product.isActive ? 'Active' : 'Inactive'}
            </Badge>
            {product.serialTracking && <Badge className="text-xs bg-ace-blue">Serial Tracked</Badge>}
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-sm text-ace-muted">Company avg cost</div>
          <div className="text-lg font-bold text-ace-navy font-mono">{formatMwk(product.avgCostMinor ?? 0)}</div>
        </div>
      </div>

      {/* Stock balances card */}
      {product.productType !== 'service' && product.stockBalances.length > 0 && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-ace-navy mb-3">Current Stock Levels</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {product.stockBalances.map((b) => (
              <div key={b.locationId} className="rounded-md bg-ace-bg p-3">
                <div className="text-xs text-ace-muted">{b.location?.name ?? 'Unknown'}</div>
                <div className="text-xl font-bold text-ace-navy">{parseFloat(b.onHand ?? '0').toFixed(product.uom?.allowDecimal ? 3 : 0)}</div>
                <div className="text-xs text-ace-muted">on hand · {parseFloat(b.available ?? '0').toFixed(product.uom?.allowDecimal ? 3 : 0)} avail</div>
              </div>
            ))}
            <div className="rounded-md bg-ace-navy p-3 text-white">
              <div className="text-xs opacity-70">Total company-wide</div>
              <div className="text-xl font-bold">{totalOnHand.toFixed(product.uom?.allowDecimal ? 3 : 0)}</div>
              <div className="text-xs opacity-70">{product.uom?.symbol ?? 'units'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Bundle components */}
      {product.productType === 'bundle' && product.bundleComponents && product.bundleComponents.length > 0 && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-ace-navy mb-3">Bundle Components</h2>
          <div className="space-y-2">
            {product.bundleComponents.map((c) => (
              <div key={c.componentProductId} className="flex items-center justify-between text-sm">
                <span>{c.componentProduct?.name ?? c.componentProductId}</span>
                <span className="font-mono text-ace-muted">× {c.quantity}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ProductForm
        product={product}
        categories={categories}
        uoms={uoms}
        taxRates={allTaxRates}
        allProducts={allProducts}
        isEditing
      />
    </div>
  );
}
