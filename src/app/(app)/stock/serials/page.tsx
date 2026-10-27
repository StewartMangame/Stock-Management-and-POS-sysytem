import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { serialNumbers, products, locations } from '@/server/db/schema';
import { desc, eq, ilike, and, asc, or, sql } from 'drizzle-orm';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/utils';
import { Search } from 'lucide-react';

export const metadata: Metadata = { title: 'Serial Numbers | Ace Holdings POS' };

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  in_stock: 'default',
  reserved: 'secondary',
  sold: 'outline',
  returned: 'secondary',
  written_off: 'destructive',
  adjusted_out: 'destructive',
};

export default async function SerialsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  try {
    await authorize(PERMISSIONS.SERIALS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const sp = await searchParams;
  const page = parseInt(sp.page ?? '1');
  const pageSize = 50;

  const conditions = [];
  if (sp.q) {
    conditions.push(
      sql`LOWER(${serialNumbers.serialNumber}) LIKE ${`%${sp.q.toLowerCase()}%`}`,
    );
  }
  if (sp.status) {
    conditions.push(eq(serialNumbers.status, sp.status));
  }

  const serials = await db.query.serialNumbers.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(serialNumbers.createdAt)],
    with: {
      product: { columns: { id: true, name: true, sku: true } },
      location: { columns: { id: true, name: true } },
    },
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const STATUS_LABELS = ['in_stock', 'reserved', 'sold', 'returned', 'written_off', 'adjusted_out'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Serial Number Lookup</h1>
          <p className="text-sm text-ace-muted">Search and trace individual unit serial numbers across the system.</p>
        </div>
      </div>

      {/* Search */}
      <form method="get" className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ace-muted" />
          <input
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="Search serial number…"
            className="pl-9 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ace-blue w-64"
            id="serial-search"
          />
        </div>
        <select
          name="status"
          defaultValue={sp.status ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ace-blue"
          id="serial-status-filter"
        >
          <option value="">All Statuses</option>
          {STATUS_LABELS.map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
        <button type="submit" className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">
          Search
        </button>
        <Link href="/stock/serials" className="rounded-md px-3 py-2 text-sm text-ace-muted hover:text-ace-blue">
          Clear
        </Link>
      </form>

      {/* Table */}
      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Serial Number</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Current Location</TableHead>
              <TableHead>Warranty End</TableHead>
              <TableHead>Registered</TableHead>
              <TableHead>Last Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {serials.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-ace-muted">
                  {sp.q ? `No serial numbers matching "${sp.q}"` : 'No serial numbers registered yet.'}
                </TableCell>
              </TableRow>
            ) : (
              serials.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono font-semibold text-sm text-ace-navy">
                    {s.serialNumber}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Link href={`/stock/products/${s.productId}`} className="hover:text-ace-blue hover:underline">
                      {s.product?.name ?? '—'}
                    </Link>
                    <div className="text-xs text-ace-muted font-mono">{s.product?.sku}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[s.status] ?? 'outline'} className="text-xs capitalize">
                      {s.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-ace-navy">
                    {s.location?.name ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-ace-muted">
                    {s.warrantyEnd ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-ace-muted">
                    {formatDateTime(s.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm text-ace-muted">
                    {s.updatedAt ? formatDateTime(s.updatedAt) : '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-ace-muted">
        <span>Showing {serials.length} serials (page {page})</span>
        <div className="flex gap-2">
          {page > 1 && (
            <Link href={`/stock/serials?page=${page - 1}${sp.q ? `&q=${sp.q}` : ''}`} className="rounded-md border px-3 py-1.5 hover:bg-gray-50">
              ← Previous
            </Link>
          )}
          {serials.length === pageSize && (
            <Link href={`/stock/serials?page=${page + 1}${sp.q ? `&q=${sp.q}` : ''}`} className="rounded-md border px-3 py-1.5 hover:bg-gray-50">
              Next →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
