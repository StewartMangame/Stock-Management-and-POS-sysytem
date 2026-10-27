import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { listStockCounts } from '@/server/services/stock/stock-counts';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils';
import { Plus, ClipboardList } from 'lucide-react';

export const metadata: Metadata = { title: 'Stock Counts | Ace Holdings POS' };

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  in_progress: 'default',
  reconciled: 'secondary',
  cancelled: 'destructive',
};

export default async function StockCountsPage() {
  try {
    await authorize(PERMISSIONS.STOCK_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const counts = await listStockCounts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Stock Counts</h1>
          <p className="text-sm text-ace-muted">Physical inventory counts with variance reconciliation.</p>
        </div>
        <Link href="/stock/counts/new">
          <Button id="new-count-btn">
            <Plus className="mr-2 h-4 w-4" />
            Start New Count
          </Button>
        </Link>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Count Date</TableHead>
              <TableHead>Lines</TableHead>
              <TableHead>Counted By</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {counts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-ace-muted">
                  <ClipboardList className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                  No stock counts recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              counts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-sm font-semibold text-ace-navy">{c.countNumber}</TableCell>
                  <TableCell className="text-sm">{c.location?.name ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[c.status] ?? 'outline'} className="text-xs capitalize">
                      {c.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{formatDateTime(c.countedAt)}</TableCell>
                  <TableCell className="text-sm">{c.items.length} items</TableCell>
                  <TableCell className="text-sm text-ace-muted">{c.createdByUser?.name ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    {c.status === 'in_progress' ? (
                      <Link href={`/stock/counts/${c.id}`}>
                        <Button size="sm" id={`reconcile-count-${c.countNumber.toLowerCase()}`}>
                          Reconcile
                        </Button>
                      </Link>
                    ) : (
                      <Link href={`/stock/counts/${c.id}`}>
                        <Button variant="ghost" size="sm">View</Button>
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
