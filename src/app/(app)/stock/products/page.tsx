import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { listProducts } from '@/server/services/stock/products';
import { listCategories } from '@/server/services/stock/categories';
import { db } from '@/server/db';
import { taxRates } from '@/server/db/schema';
import { asc } from 'drizzle-orm';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatMwk } from '@/lib/money';
import { Package, Plus, AlertTriangle, Layers, Wrench } from 'lucide-react';

export const metadata: Metadata = { title: 'Products | Ace Holdings POS' };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; category?: string; type?: string; lowstock?: string }>;
}) {
  try {
    await authorize(PERMISSIONS.PRODUCTS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const sp = await searchParams;
  const [productList, categoryList] = await Promise.all([
    listProducts({
      search: sp.search,
      categoryId: sp.category,
      productType: sp.type,
      lowStockOnly: sp.lowstock === '1',
    }),
    listCategories(),
  ]);

  const typeIcon: Record<string, React.ReactNode> = {
    standard: <Package className="h-3.5 w-3.5" />,
    bundle: <Layers className="h-3.5 w-3.5" />,
    service: <Wrench className="h-3.5 w-3.5" />,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Product Catalog</h1>
          <p className="text-sm text-ace-muted">
            {productList.length} product{productList.length !== 1 ? 's' : ''} registered
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/stock/products/import">
            <Button variant="outline" id="import-products-btn">Import CSV</Button>
          </Link>
          <Link href="/stock/products/new">
            <Button id="new-product-btn">
              <Plus className="mr-2 h-4 w-4" />
              New Product
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <form method="get" className="flex flex-wrap gap-3">
        <input
          name="search"
          defaultValue={sp.search ?? ''}
          placeholder="Search name, SKU, barcode…"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ace-blue w-64"
          id="product-search"
        />
        <select
          name="category"
          defaultValue={sp.category ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ace-blue"
          id="product-category-filter"
        >
          <option value="">All Categories</option>
          {categoryList.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          name="type"
          defaultValue={sp.type ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ace-blue"
          id="product-type-filter"
        >
          <option value="">All Types</option>
          <option value="standard">Standard</option>
          <option value="bundle">Bundle</option>
          <option value="service">Service</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-ace-navy cursor-pointer">
          <input type="checkbox" name="lowstock" value="1" defaultChecked={sp.lowstock === '1'} className="accent-ace-blue" id="lowstock-filter" />
          Low stock only
        </label>
        <Button type="submit" variant="outline" size="sm">Filter</Button>
        <Link href="/stock/products">
          <Button variant="ghost" size="sm">Clear</Button>
        </Link>
      </form>

      {/* Table */}
      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>UOM</TableHead>
              <TableHead className="text-right">Selling Price</TableHead>
              <TableHead className="text-right">Avg Cost</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {productList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-ace-muted">
                  No products found.
                </TableCell>
              </TableRow>
            ) : (
              productList.map((p) => {
                const totalOnHand = p.stockBalances.reduce((s, b) => s + parseFloat(b.onHand ?? '0'), 0);
                const minAlert = parseFloat(p.minStockAlert ?? '0');
                const isLowStock = p.productType !== 'service' && minAlert > 0 && totalOnHand <= minAlert;

                return (
                  <TableRow key={p.id} className="group">
                    <TableCell className="font-medium text-ace-navy">
                      <div className="flex items-center gap-2">
                        {isLowStock && <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />}
                        <div>
                          <div>{p.name}</div>
                          {p.serialTracking && (
                            <span className="text-[10px] font-semibold text-ace-blue bg-ace-band rounded px-1">SERIAL</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs font-mono bg-gray-100 rounded px-1.5 py-0.5">{p.sku}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1 text-xs capitalize">
                        {typeIcon[p.productType ?? 'standard']}
                        {p.productType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-ace-muted">{p.category?.name ?? '—'}</TableCell>
                    <TableCell className="text-sm">{p.uom?.symbol ?? '—'}</TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      {formatMwk(p.sellingPriceMinor)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono text-ace-muted">
                      {p.productType === 'service' ? '—' : formatMwk(p.avgCostMinor ?? 0)}
                    </TableCell>
                    <TableCell>
                      {p.productType === 'service' ? (
                        <span className="text-xs text-ace-muted">Service</span>
                      ) : (
                        <span className={`text-sm font-semibold ${isLowStock ? 'text-amber-600' : 'text-ace-navy'}`}>
                          {totalOnHand.toFixed(p.uom?.allowDecimal ? 3 : 0)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/stock/products/${p.id}`}>
                        <Button variant="ghost" size="sm" id={`edit-product-${p.sku.toLowerCase()}`}>
                          Edit
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
