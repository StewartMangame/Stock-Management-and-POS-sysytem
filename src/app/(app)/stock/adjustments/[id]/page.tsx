import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getStockAdjustmentById } from '@/server/services/stock/stock-adjustments';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMwk } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';
import { ArrowLeft, MapPin, Calendar, Tag, ShieldCheck, UserCheck } from 'lucide-react';

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = { title: 'Stock Adjustment Details | Ace Holdings POS' };

const REASON_LABELS: Record<string, string> = {
  damaged: 'Damaged / Write-off',
  expired: 'Expired',
  internal_use: 'Internal Company Use',
  found: 'Found / Surplus',
  correction: 'Quantity Correction',
};

export default async function StockAdjustmentDetailPage({ params }: Props) {
  const { id } = await params;

  try {
    await authorize(PERMISSIONS.STOCK_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const adj = await getStockAdjustmentById(id);
  if (!adj) {
    notFound();
  }

  const totalCostMinor = adj.items.reduce((sum, it) => sum + (it.totalCostMinor ?? 0), 0);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/stock/adjustments">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold font-mono text-ace-navy">{adj.adjNumber}</h1>
              <Badge
                variant={adj.type === 'in' ? 'default' : 'destructive'}
                className="text-xs"
              >
                Stock {adj.type === 'in' ? 'IN ↑' : 'OUT ↓'}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {REASON_LABELS[adj.reason] ?? adj.reason}
              </Badge>
            </div>
            <p className="text-sm text-ace-muted">
              Created on {formatDateTime(adj.createdAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <MapPin className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">Location</span>
            <span className="text-sm font-semibold text-ace-navy">
              {adj.location?.name}
            </span>
            <span className="text-xs text-gray-500 block capitalize">
              {adj.location?.type}
            </span>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <Tag className="h-5 w-5 text-purple-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">Reason</span>
            <span className="text-sm font-semibold text-ace-navy">
              {REASON_LABELS[adj.reason] ?? adj.reason}
            </span>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <Calendar className="h-5 w-5 text-ace-blue shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">Total Impact Value</span>
            <span className="text-sm font-bold text-ace-navy font-mono">
              {formatMwk(totalCostMinor)}
            </span>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <UserCheck className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">Processed By</span>
            <span className="text-sm font-semibold text-ace-navy">
              {adj.createdByUser?.name ?? 'Staff'}
            </span>
          </div>
        </div>
      </div>

      {adj.notes && (
        <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-sm text-blue-900">
          <span className="font-semibold block mb-0.5">Notes / Justification:</span>
          {adj.notes}
        </div>
      )}

      {/* Items Table */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden space-y-2">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-ace-navy">Adjusted Items</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Unit Cost</TableHead>
              <TableHead className="text-right">Total Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adj.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="font-medium text-ace-navy">{item.product?.name}</div>
                  <div className="text-xs text-ace-muted font-mono">{item.product?.sku}</div>
                  {item.serialNumbers && item.serialNumbers.length > 0 && (
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-purple-700 flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" />
                        Serials:
                      </span>
                      {item.serialNumbers.map((s, idx) => (
                        <span
                          key={idx}
                          className="inline-block bg-purple-50 text-purple-800 text-[11px] font-mono px-1.5 py-0.5 rounded border border-purple-200"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-semibold">
                  {item.quantity}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatMwk(item.unitCostMinor ?? 0)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-bold text-ace-navy">
                  {formatMwk(item.totalCostMinor ?? 0)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
