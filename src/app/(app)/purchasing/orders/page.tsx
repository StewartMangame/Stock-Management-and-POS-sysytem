import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { listPurchaseOrders } from '@/server/services/purchasing/purchase-orders';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatMwk } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';
import { Plus, Eye, ShoppingCart } from 'lucide-react';

export const metadata: Metadata = { title: 'Purchase Orders | Ace Holdings POS' };

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  draft: { label: 'Draft', variant: 'outline' },
  submitted: { label: 'Submitted', variant: 'secondary' },
  partially_received: { label: 'Partial', variant: 'default' },
  received: { label: 'Received', variant: 'default' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
};

export default async function PurchaseOrdersPage() {
  try {
    await authorize(PERMISSIONS.PURCHASE_ORDERS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const orders = await listPurchaseOrders();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Purchase Orders</h1>
          <p className="text-sm text-ace-muted">
            Manage international and local procurement with multi-currency tracking.
          </p>
        </div>
        <Link href="/purchasing/orders/new">
          <Button id="new-po-btn">
            <Plus className="mr-2 h-4 w-4" />
            New Purchase Order
          </Button>
        </Link>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO Number</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead className="text-right">Supplier Amount</TableHead>
              <TableHead className="text-right">MWK Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-ace-muted">
                  <div className="flex flex-col items-center justify-center gap-1">
                    <ShoppingCart className="h-6 w-6 text-gray-400" />
                    <p>No purchase orders found.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              orders.map((po) => {
                const statusMeta = STATUS_CONFIG[po.status] ?? {
                  label: po.status,
                  variant: 'outline' as const,
                };
                return (
                  <TableRow key={po.id}>
                    <TableCell className="font-mono text-sm font-semibold text-ace-navy">
                      <Link
                        href={`/purchasing/orders/${po.id}`}
                        className="hover:underline text-ace-blue"
                      >
                        {po.poNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{po.orderDate}</TableCell>
                    <TableCell className="text-sm font-medium">
                      {po.supplier?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-ace-muted">
                      {po.location?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {po.currency}
                      {po.currency !== 'MWK' && (
                        <span className="block text-xs text-gray-500">
                          @{Number(po.exchangeRate).toLocaleString()}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {Number(po.totalSupplierCurrency).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      {po.currency}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold text-ace-navy">
                      {formatMwk(po.totalMinor)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusMeta.variant} className="capitalize text-xs">
                        {statusMeta.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/purchasing/orders/${po.id}`}>
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4 mr-1" />
                          View
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
