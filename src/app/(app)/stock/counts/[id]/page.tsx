import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getStockCountById } from '@/server/services/stock/stock-counts';
import { db } from '@/server/db';
import { serialNumbers, stockBalances } from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';
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
import { ArrowLeft, MapPin, Calendar, ClipboardCheck, UserCheck } from 'lucide-react';
import { ReconcileClient } from './ReconcileClient';

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = { title: 'Stock Count Details | Ace Holdings POS' };

export default async function StockCountDetailPage({ params }: Props) {
  const { id } = await params;

  try {
    await authorize(PERMISSIONS.STOCK_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const count = await getStockCountById(id);
  if (!count) {
    notFound();
  }

  const isReconciled = count.status === 'reconciled';

  // If in progress, fetch active serials and live balances
  let activeSerials: Array<{ id: string; productId: string; serialNumber: string }> = [];
  let itemsWithSystemQty = count.items.map((it) => ({
    productId: it.productId,
    product: {
      id: it.product.id,
      name: it.product.name,
      sku: it.product.sku,
      serialTracking: it.product.serialTracking,
      avgCostMinor: Number(it.product.avgCostMinor),
    },
    systemQty: Number(it.systemQty),
    initialCountedQty: Number(it.countedQty),
  }));

  if (!isReconciled) {
    // Fetch live system onHand balances
    const balances = await db.query.stockBalances.findMany({
      where: eq(stockBalances.locationId, count.locationId),
    });
    const balanceMap = new Map(balances.map((b) => [b.productId, Number(b.onHand)]));

    itemsWithSystemQty = itemsWithSystemQty.map((it) => ({
      ...it,
      systemQty: balanceMap.get(it.productId) ?? 0,
    }));

    activeSerials = await db.query.serialNumbers.findMany({
      where: and(
        eq(serialNumbers.locationId, count.locationId),
        eq(serialNumbers.status, 'in_stock')
      ),
      columns: {
        id: true,
        productId: true,
        serialNumber: true,
      },
    });
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/stock/counts">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold font-mono text-ace-navy">
                {count.countNumber}
              </h1>
              <Badge
                variant={isReconciled ? 'default' : 'secondary'}
                className={isReconciled ? 'bg-emerald-600 text-xs' : 'text-xs'}
              >
                {isReconciled ? 'Reconciled' : 'In Progress'}
              </Badge>
            </div>
            <p className="text-sm text-ace-muted">
              Count started on {formatDateTime(count.countedAt)}
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
              {count.location?.name}
            </span>
            <span className="text-xs text-gray-500 block capitalize">
              {count.location?.type}
            </span>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <Calendar className="h-5 w-5 text-purple-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">Count Date</span>
            <span className="text-sm font-semibold text-ace-navy">
              {formatDateTime(count.countedAt)}
            </span>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <ClipboardCheck className="h-5 w-5 text-ace-blue shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">Items Counted</span>
            <span className="text-sm font-semibold text-ace-navy">
              {count.items.length} line(s)
            </span>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <UserCheck className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">
              {isReconciled ? 'Reconciled By' : 'Counted By'}
            </span>
            <span className="text-sm font-semibold text-ace-navy">
              {isReconciled
                ? count.reconciledByUser?.name ?? 'System'
                : count.createdByUser?.name ?? 'Staff'}
            </span>
            {isReconciled && count.reconciledAt && (
              <span className="text-xs text-gray-500 block">
                {formatDateTime(count.reconciledAt)}
              </span>
            )}
          </div>
        </div>
      </div>

      {count.notes && (
        <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-sm text-blue-900">
          <span className="font-semibold block mb-0.5">Notes:</span>
          {count.notes}
        </div>
      )}

      {/* Main Content Area */}
      {!isReconciled ? (
        <ReconcileClient
          countId={count.id}
          countNumber={count.countNumber}
          items={itemsWithSystemQty}
          activeSerials={activeSerials}
        />
      ) : (
        <div className="rounded-lg border bg-white shadow-sm overflow-hidden space-y-2">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold text-ace-navy">
              Reconciled Results & Variance Ledger
            </h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">System Qty</TableHead>
                <TableHead className="text-right">Physical Count</TableHead>
                <TableHead className="text-right">Variance Qty</TableHead>
                <TableHead className="text-right">Unit Avg Cost</TableHead>
                <TableHead className="text-right">Variance Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {count.items.map((it) => {
                const varQty = Number(it.varianceQty);
                return (
                  <TableRow key={it.id}>
                    <TableCell>
                      <div className="font-medium text-ace-navy">{it.product.name}</div>
                      <div className="text-xs text-ace-muted font-mono">{it.product.sku}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {Number(it.systemQty)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">
                      {Number(it.countedQty)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">
                      <span
                        className={
                          varQty > 0
                            ? 'text-emerald-600'
                            : varQty < 0
                            ? 'text-red-600'
                            : 'text-gray-400'
                        }
                      >
                        {varQty > 0 ? `+${varQty}` : varQty}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatMwk(it.unitCostMinor)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-bold">
                      <span
                        className={
                          it.varianceValueMinor > 0
                            ? 'text-emerald-600'
                            : it.varianceValueMinor < 0
                            ? 'text-red-600'
                            : 'text-gray-400'
                        }
                      >
                        {formatMwk(it.varianceValueMinor)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
