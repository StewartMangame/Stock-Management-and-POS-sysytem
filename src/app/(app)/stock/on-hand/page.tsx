import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { stockBalances, products, locations, categories } from '@/server/db/schema';
import { eq, asc, and, sql } from 'drizzle-orm';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatMwk } from '@/lib/money';
import { AlertTriangle, Package } from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Stock On Hand | Ace Holdings POS' };

export default async function StockOnHandPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; category?: string; lowstock?: string }>;
}) {
  try {
    await authorize(PERMISSIONS.STOCK_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const sp = await searchParams;

  // Load all stock balances with product and location details
  const balances = await db.query.stockBalances.findMany({
    with: {
      product: {
        with: { category: true, uom: true },
      },
      location: true,
    },
    orderBy: (sb, { asc }) => [asc(sb.productId), asc(sb.locationId)],
  });

  // Group by product
  const productMap = new Map<string, {
    product: typeof balances[0]['product'];
    balancesByLocation: Array<{ locationName: string; onHand: number; available: number; locationId: string }>;
    totalOnHand: number;
    isLowStock: boolean;
  }>();

  for (const b of balances) {
    if (!b.product) continue;
    if (sp.category && b.product.categoryId !== sp.category) continue;
    if (sp.location && b.locationId !== sp.location) continue;

    const onHand = parseFloat(b.onHand ?? '0');
    const available = parseFloat(b.available ?? '0');

    if (!productMap.has(b.productId)) {
      productMap.set(b.productId, {
        product: b.product,
        balancesByLocation: [],
        totalOnHand: 0,
        isLowStock: false,
      });
    }

    const entry = productMap.get(b.productId)!;
    entry.balancesByLocation.push({
      locationId: b.locationId,
      locationName: b.location?.name ?? 'Unknown',
      onHand,
      available,
    });
    entry.totalOnHand += onHand;
  }

  // Calculate low stock flags
  for (const entry of productMap.values()) {
    const minAlert = parseFloat(entry.product.minStockAlert ?? '0');
    entry.isLowStock = minAlert > 0 && entry.totalOnHand <= minAlert;
  }

  // Filter low stock
  let rows = Array.from(productMap.values());
  if (sp.lowstock === '1') {
    rows = rows.filter((r) => r.isLowStock);
  }

  // Load filter data
  const [locationList, categoryList] = await Promise.all([
    db.query.locations.findMany({ orderBy: [asc(locations.name)] }),
    db.query.categories.findMany({ orderBy: [asc(categories.name)] }),
  ]);

  // Get unique locations in dataset
  const uniqueLocations = new Set<string>();
  rows.forEach((r) => r.balancesByLocation.forEach((b) => uniqueLocations.add(b.locationId)));
  const colLocations = sp.location
    ? locationList.filter((l) => l.id === sp.location)
    : locationList.filter((l) => uniqueLocations.has(l.id));

  const lowCount = Array.from(productMap.values()).filter((r) => r.isLowStock).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Stock On Hand</h1>
          <p className="text-sm text-ace-muted">
            {rows.length} product{rows.length !== 1 ? 's' : ''} stocked
            {lowCount > 0 && (
              <span className="ml-2 text-amber-600 font-medium">· {lowCount} low stock alert{lowCount !== 1 ? 's' : ''}</span>
            )}
          </p>
        </div>
        <Link href="/stock/movements">
          <span className="text-sm text-ace-blue hover:underline cursor-pointer">View movement history →</span>
        </Link>
      </div>

      {/* Filters */}
      <form method="get" className="flex flex-wrap gap-3">
        <select
          name="location"
          defaultValue={sp.location ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ace-blue"
          id="oh-location-filter"
        >
          <option value="">All Locations</option>
          {locationList.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <select
          name="category"
          defaultValue={sp.category ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ace-blue"
          id="oh-category-filter"
        >
          <option value="">All Categories</option>
          {categoryList.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-ace-navy cursor-pointer">
          <input type="checkbox" name="lowstock" value="1" defaultChecked={sp.lowstock === '1'} className="accent-ace-blue" id="oh-lowstock-filter" />
          Low stock only
        </label>
        <button type="submit" className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">
          Filter
        </button>
        <Link href="/stock/on-hand" className="rounded-md px-3 py-2 text-sm text-ace-muted hover:text-ace-blue">
          Clear
        </Link>
      </form>

      {/* Table */}
      <div className="rounded-lg border bg-white shadow-sm overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Category</TableHead>
              {colLocations.map((l) => (
                <TableHead key={l.id} className="text-right">{l.name}</TableHead>
              ))}
              <TableHead className="text-right font-bold">Total On Hand</TableHead>
              <TableHead className="text-right">Avg Cost</TableHead>
              <TableHead className="text-right">Stock Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6 + colLocations.length} className="h-24 text-center text-ace-muted">
                  No stock on hand matching filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map(({ product: p, balancesByLocation, totalOnHand, isLowStock }) => {
                const stockValue = totalOnHand * Number(p.avgCostMinor ?? 0);
                return (
                  <TableRow key={p.id} className={isLowStock ? 'bg-amber-50' : ''}>
                    <TableCell className="font-medium text-ace-navy">
                      <div className="flex items-center gap-2">
                        {isLowStock && <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />}
                        <div>
                          <Link href={`/stock/products/${p.id}`} className="hover:text-ace-blue hover:underline">
                            {p.name}
                          </Link>
                          {p.serialTracking && (
                            <div>
                              <span className="text-[10px] font-semibold text-ace-blue bg-ace-band rounded px-1">SERIAL</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs font-mono bg-gray-100 rounded px-1.5 py-0.5">{p.sku}</code>
                    </TableCell>
                    <TableCell className="text-sm text-ace-muted">{p.category?.name ?? '—'}</TableCell>
                    {colLocations.map((loc) => {
                      const b = balancesByLocation.find((x) => x.locationId === loc.id);
                      return (
                        <TableCell key={loc.id} className="text-right text-sm font-mono">
                          {b ? b.onHand.toFixed(p.uom?.allowDecimal ? 3 : 0) : '—'}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right font-bold text-ace-navy font-mono">
                      {totalOnHand.toFixed(p.uom?.allowDecimal ? 3 : 0)}
                      {isLowStock && (
                        <div className="text-xs text-amber-600 font-normal">min: {p.minStockAlert}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono text-ace-muted">
                      {formatMwk(p.avgCostMinor ?? 0)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono font-semibold">
                      {formatMwk(Math.round(stockValue))}
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
