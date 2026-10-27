import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { stockMovements, products, locations } from '@/server/db/schema';
import { desc, eq, and, asc } from 'drizzle-orm';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatMwk } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Stock Movements | Ace Holdings POS' };

const MOVEMENT_LABELS: Record<string, string> = {
  opening: 'Opening Stock',
  purchase_receipt: 'Purchase Receipt',
  sale_delivery: 'Sale',
  customer_return: 'Customer Return',
  supplier_return: 'Supplier Return',
  adjustment: 'Adjustment',
  count_variance: 'Count Variance',
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
};

const MOVEMENT_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  opening: 'secondary',
  purchase_receipt: 'default',
  sale_delivery: 'destructive',
  customer_return: 'default',
  supplier_return: 'destructive',
  adjustment: 'secondary',
  count_variance: 'secondary',
  transfer_in: 'default',
  transfer_out: 'destructive',
};

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; location?: string; type?: string; page?: string }>;
}) {
  try {
    await authorize(PERMISSIONS.STOCK_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const sp = await searchParams;
  const page = parseInt(sp.page ?? '1');
  const pageSize = 50;

  const movements = await db.query.stockMovements.findMany({
    orderBy: [desc(stockMovements.occurredAt), desc(stockMovements.seq)],
    with: {
      product: { columns: { id: true, name: true, sku: true } },
      location: { columns: { id: true, name: true } },
    },
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const [locationList, productList] = await Promise.all([
    db.query.locations.findMany({ orderBy: [asc(locations.name)] }),
    db.query.products.findMany({
      columns: { id: true, name: true, sku: true },
      orderBy: [asc(products.name)],
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Stock Movement Ledger</h1>
          <p className="text-sm text-ace-muted">Immutable audit trail of all inventory changes. Page {page}.</p>
        </div>
      </div>

      {/* Filters */}
      <form method="get" className="flex flex-wrap gap-3">
        <select
          name="product"
          defaultValue={sp.product ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ace-blue max-w-48"
          id="mv-product-filter"
        >
          <option value="">All Products</option>
          {productList.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          name="location"
          defaultValue={sp.location ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ace-blue"
          id="mv-location-filter"
        >
          <option value="">All Locations</option>
          {locationList.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <select
          name="type"
          defaultValue={sp.type ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ace-blue"
          id="mv-type-filter"
        >
          <option value="">All Types</option>
          {Object.entries(MOVEMENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button type="submit" className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">
          Filter
        </button>
        <Link href="/stock/movements" className="rounded-md px-3 py-2 text-sm text-ace-muted hover:text-ace-blue">
          Clear
        </Link>
      </form>

      {/* Table */}
      <div className="rounded-lg border bg-white shadow-sm overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Date &amp; Time</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Unit Cost</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-ace-muted">
                  No movements found.
                </TableCell>
              </TableRow>
            ) : (
              movements.map((m) => {
                const qty = parseFloat(m.quantity);
                const isPositive = qty >= 0;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs text-ace-muted font-mono">{m.seq?.toString()}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatDateTime(m.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={MOVEMENT_VARIANT[m.movementType] ?? 'outline'} className="text-xs whitespace-nowrap">
                        {MOVEMENT_LABELS[m.movementType] ?? m.movementType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={`/stock/products/${m.productId}`} className="hover:text-ace-blue hover:underline">
                        {m.product?.name ?? m.productId}
                      </Link>
                      <div className="text-xs text-ace-muted font-mono">{m.product?.sku}</div>
                    </TableCell>
                    <TableCell className="text-sm text-ace-muted">{m.location?.name ?? '—'}</TableCell>
                    <TableCell className={`text-right font-mono font-semibold text-sm ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                      {isPositive ? '+' : ''}{qty.toFixed(3)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-ace-muted">
                      {m.unitCostMinor ? formatMwk(m.unitCostMinor) : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-ace-muted">
                      {m.referenceType && (
                        <span className="capitalize">{m.referenceType.replace(/_/g, ' ')}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-ace-muted max-w-xs truncate" title={m.notes ?? ''}>
                      {m.notes ?? '—'}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-ace-muted">
        <span>Showing {movements.length} movements (page {page})</span>
        <div className="flex gap-2">
          {page > 1 && (
            <Link href={`/stock/movements?page=${page - 1}`} className="rounded-md border px-3 py-1.5 hover:bg-gray-50">
              ← Previous
            </Link>
          )}
          {movements.length === pageSize && (
            <Link href={`/stock/movements?page=${page + 1}`} className="rounded-md border px-3 py-1.5 hover:bg-gray-50">
              Next →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
