import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getPurchaseOrderById } from '@/server/services/purchasing/purchase-orders';
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
import { ArrowLeft, Building2, MapPin, Calendar, Receipt, FileText } from 'lucide-react';
import { PODetailActions } from './PODetailActions';
import { EntityHistoryTab } from '@/components/shared/EntityHistoryTab';

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = { title: 'Purchase Order Details | Ace Holdings POS' };

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  draft: { label: 'Draft', variant: 'outline' },
  submitted: { label: 'Submitted', variant: 'secondary' },
  partially_received: { label: 'Partially Received', variant: 'default' },
  received: { label: 'Fully Received', variant: 'default' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
};

export default async function PurchaseOrderDetailPage({ params }: Props) {
  const { id } = await params;

  try {
    await authorize(PERMISSIONS.PURCHASE_ORDERS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const po = await getPurchaseOrderById(id);
  if (!po) {
    notFound();
  }

  const statusMeta = STATUS_CONFIG[po.status] ?? {
    label: po.status,
    variant: 'outline' as const,
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/purchasing/orders">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold font-mono text-ace-navy">{po.poNumber}</h1>
              <Badge variant={statusMeta.variant} className="capitalize text-xs">
                {statusMeta.label}
              </Badge>
            </div>
            <p className="text-sm text-ace-muted">
              Created on {formatDateTime(po.createdAt)}
            </p>
          </div>
        </div>

        <PODetailActions poId={po.id} poNumber={po.poNumber} status={po.status} />
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <Building2 className="h-5 w-5 text-ace-blue shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">Supplier</span>
            <span className="text-sm font-semibold text-ace-navy">
              {po.supplier?.name}
            </span>
            <span className="text-xs text-gray-500 block font-mono">
              {po.supplier?.code}
            </span>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <MapPin className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">Destination</span>
            <span className="text-sm font-semibold text-ace-navy">
              {po.location?.name}
            </span>
            <span className="text-xs text-gray-500 block capitalize">
              {po.location?.type}
            </span>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <Calendar className="h-5 w-5 text-purple-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">Order Date</span>
            <span className="text-sm font-semibold text-ace-navy">{po.orderDate}</span>
            {po.expectedDeliveryDate && (
              <span className="text-xs text-gray-500 block">
                Exp: {po.expectedDeliveryDate}
              </span>
            )}
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <Receipt className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">Order Total</span>
            <span className="text-sm font-bold text-ace-navy font-mono">
              {formatMwk(po.totalMinor)}
            </span>
            {po.currency !== 'MWK' && (
              <span className="text-xs text-gray-500 block font-mono">
                {Number(po.totalSupplierCurrency).toLocaleString()} {po.currency} (@
                {Number(po.exchangeRate).toLocaleString()})
              </span>
            )}
          </div>
        </div>
      </div>

      {po.notes && (
        <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-sm text-blue-900">
          <span className="font-semibold block mb-0.5">Notes:</span>
          {po.notes}
        </div>
      )}

      {/* Order Line Items Table */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-ace-navy">Ordered Items</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead className="text-right">Unit Cost ({po.currency})</TableHead>
              <TableHead className="text-right">Line Total ({po.currency})</TableHead>
              <TableHead className="text-right">Total (MWK)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {po.items.map((item) => {
              const ordered = Number(item.orderedQty);
              const received = Number(item.receivedQty);
              const remaining = Math.max(0, ordered - received);
              const isFulfilled = remaining === 0;

              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium text-ace-navy">
                      {item.product?.name}
                    </div>
                    <div className="text-xs text-ace-muted font-mono">
                      {item.product?.sku}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {ordered}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    <span
                      className={
                        received > 0
                          ? 'text-emerald-600 font-semibold'
                          : 'text-gray-400'
                      }
                    >
                      {received}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    <span
                      className={
                        isFulfilled
                          ? 'text-gray-400'
                          : remaining < ordered
                          ? 'text-amber-600 font-medium'
                          : 'text-ace-navy'
                      }
                    >
                      {remaining}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {Number(item.unitCostSupplier).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 4,
                    })}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {Number(item.lineTotalSupplier).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold text-ace-navy">
                    {formatMwk(
                      Math.round(Number(item.orderedQty) * item.unitCostMwkMinor)
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Goods Receipts Against this PO */}
      {po.goodsReceipts && po.goodsReceipts.length > 0 && (
        <div className="rounded-lg border bg-white shadow-sm overflow-hidden space-y-2">
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ace-navy flex items-center gap-2">
              <FileText className="h-5 w-5 text-ace-blue" />
              Goods Receipts for this PO
            </h2>
            <span className="text-xs text-ace-muted">
              {po.goodsReceipts.length} receipt(s) recorded
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>GRN Number</TableHead>
                <TableHead>Received Date</TableHead>
                <TableHead>Invoice #</TableHead>
                <TableHead className="text-right">Items Value (MWK)</TableHead>
                <TableHead className="text-right">Landed Costs (MWK)</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.goodsReceipts.map((grn) => (
                <TableRow key={grn.id}>
                  <TableCell className="font-mono text-sm font-semibold text-ace-navy">
                    <Link
                      href={`/purchasing/receipts/${grn.id}`}
                      className="hover:underline text-ace-blue"
                    >
                      {grn.grnNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{grn.receivedDate}</TableCell>
                  <TableCell className="text-sm text-ace-muted">
                    {grn.supplierInvoiceNumber || '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatMwk(grn.totalItemsMwkMinor)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-purple-700">
                    {formatMwk(grn.totalLandedMwkMinor)}
                  </TableCell>
                  <TableCell>
                    <Link href={`/purchasing/receipts/${grn.id}`}>
                      <Button variant="ghost" size="sm">
                        View GRN
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Historical Audit Log Timeline */}
      <EntityHistoryTab entityType="purchase_order" entityId={po.id} />
    </div>
  );
}
