import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { listStockAdjustments } from '@/server/services/stock/stock-adjustments';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils';
import { Plus } from 'lucide-react';

export const metadata: Metadata = { title: 'Stock Adjustments | Ace Holdings POS' };

const REASON_LABELS: Record<string, string> = {
  damaged: 'Damaged / Write-off',
  expired: 'Expired',
  internal_use: 'Internal Use',
  found: 'Found / Surplus',
  correction: 'Quantity Correction',
};

export default async function AdjustmentsPage() {
  try {
    await authorize(PERMISSIONS.STOCK_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const adjustments = await listStockAdjustments();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Stock Adjustments</h1>
          <p className="text-sm text-ace-muted">Authorised ad-hoc stock changes with reason codes.</p>
        </div>
        <Link href="/stock/adjustments/new">
          <Button id="new-adjustment-btn">
            <Plus className="mr-2 h-4 w-4" />
            New Adjustment
          </Button>
        </Link>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adjustments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-ace-muted">
                  No adjustments recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              adjustments.map((adj) => (
                <TableRow key={adj.id}>
                  <TableCell className="font-mono text-sm font-semibold text-ace-navy">{adj.adjNumber}</TableCell>
                  <TableCell className="text-sm">{formatDateTime(adj.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={adj.type === 'in' ? 'default' : 'destructive'} className="text-xs">
                      Stock {adj.type === 'in' ? 'IN ↑' : 'OUT ↓'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-ace-muted">{REASON_LABELS[adj.reason] ?? adj.reason}</TableCell>
                  <TableCell className="text-sm">{adj.location?.name ?? '—'}</TableCell>
                  <TableCell className="text-sm">{adj.items.length} line{adj.items.length !== 1 ? 's' : ''}</TableCell>
                  <TableCell className="text-sm text-ace-muted">{adj.createdByUser?.name ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
