import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getGoodsReceiptById } from '@/server/services/purchasing/goods-receipts';
import { db } from '@/server/db';
import { serialNumbers } from '@/server/db/schema';
import { inArray } from 'drizzle-orm';
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
import { ArrowLeft, Building2, MapPin, Calendar, DollarSign, ShieldCheck, FileCheck } from 'lucide-react';

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = { title: 'Goods Receipt Details | Ace Holdings POS' };

export default async function GoodsReceiptDetailPage({ params }: Props) {
  const { id } = await params;

  try {
    await authorize(PERMISSIONS.PURCHASE_ORDERS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const grn = await getGoodsReceiptById(id);
  if (!grn) {
    notFound();
  }

  // Load any serials captured on this receipt
  const itemIds = grn.items.map((it) => it.id);
  const serials =
    itemIds.length > 0
      ? await db.query.serialNumbers.findMany({
          where: inArray(serialNumbers.goodsReceiptItemId, itemIds),
        })
      : [];

  const serialsByItem = new Map<string, string[]>();
  for (const sn of serials) {
    if (sn.goodsReceiptItemId) {
      const list = serialsByItem.get(sn.goodsReceiptItemId) ?? [];
      list.push(sn.serialNumber);
      serialsByItem.set(sn.goodsReceiptItemId, list);
    }
  }

  const totalReceiptMwkMinor = grn.totalItemsMwkMinor + grn.totalLandedMwkMinor;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/purchasing/receipts">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold font-mono text-ace-navy">{grn.grnNumber}</h1>
              <Badge variant="default" className="bg-emerald-600 text-xs">
                Completed
              </Badge>
            </div>
            <p className="text-sm text-ace-muted">
              Received on {grn.receivedDate} • Recorded {formatDateTime(grn.createdAt)}
            </p>
          </div>
        </div>

        {grn.purchaseOrder && (
          <Link href={`/purchasing/orders/${grn.purchaseOrder.id}`}>
            <Button variant="outline" size="sm">
              View PO {grn.purchaseOrder.poNumber}
            </Button>
          </Link>
        )}
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <Building2 className="h-5 w-5 text-ace-blue shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">Supplier</span>
            <span className="text-sm font-semibold text-ace-navy">
              {grn.supplier?.name}
            </span>
            <span className="text-xs text-gray-500 block font-mono">
              {grn.supplier?.code}
            </span>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <MapPin className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">Destination</span>
            <span className="text-sm font-semibold text-ace-navy">
              {grn.location?.name}
            </span>
            <span className="text-xs text-gray-500 block capitalize">
              {grn.location?.type}
            </span>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <Calendar className="h-5 w-5 text-purple-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">Invoice Ref</span>
            <span className="text-sm font-semibold text-ace-navy font-mono">
              {grn.supplierInvoiceNumber || '—'}
            </span>
            <span className="text-xs text-gray-500 block">
              Rate: @{Number(grn.exchangeRate).toLocaleString()}
            </span>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm flex items-start gap-3">
          <DollarSign className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs text-ace-muted block">Total Landed Inventory</span>
            <span className="text-sm font-bold text-ace-navy font-mono">
              {formatMwk(totalReceiptMwkMinor)}
            </span>
            <span className="text-xs text-purple-700 block font-medium">
              Landed portion: {formatMwk(grn.totalLandedMwkMinor)}
            </span>
          </div>
        </div>
      </div>

      {grn.notes && (
        <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-sm text-blue-900">
          <span className="font-semibold block mb-0.5">Notes:</span>
          {grn.notes}
        </div>
      )}

      {/* Received Items Table */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden space-y-2">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-ace-navy">Received Items & Landed Allocation</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Received Qty</TableHead>
              <TableHead className="text-right">Unit Cost ({grn.currency})</TableHead>
              <TableHead className="text-right">Base Value (MWK)</TableHead>
              <TableHead className="text-right">Landed Share</TableHead>
              <TableHead className="text-right">Landed Unit Cost</TableHead>
              <TableHead className="text-right">Total MWK</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grn.items.map((item) => {
              const itemSerials = serialsByItem.get(item.id) ?? [];
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium text-ace-navy">{item.product?.name}</div>
                    <div className="text-xs text-ace-muted font-mono">{item.product?.sku}</div>
                    {itemSerials.length > 0 && (
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-purple-700 flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          Serials:
                        </span>
                        {itemSerials.map((s, idx) => (
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
                    {Number(item.receivedQty)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {Number(item.unitCostSupplier).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 4,
                    })}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatMwk(
                      Math.round(Number(item.receivedQty) * item.unitCostMwkMinor)
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-purple-700">
                    +{formatMwk(item.landedCostShareMinor)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold text-ace-blue">
                    {formatMwk(item.landedUnitCostMinor)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-bold text-ace-navy">
                    {formatMwk(item.lineTotalMwkMinor)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Landed Costs Table */}
      {grn.landedCosts && grn.landedCosts.length > 0 && (
        <div className="rounded-lg border bg-white shadow-sm overflow-hidden space-y-2">
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ace-navy flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-purple-600" />
              Landed Costs Detail
            </h2>
            <span className="text-sm font-mono text-purple-700 font-semibold">
              Total: {formatMwk(grn.totalLandedMwkMinor)}
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cost Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead className="text-right">Exchange Rate</TableHead>
                <TableHead className="text-right">MWK Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grn.landedCosts.map((lc) => (
                <TableRow key={lc.id}>
                  <TableCell className="capitalize font-medium text-ace-navy">
                    {lc.costType}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {Number(lc.amount).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{lc.currency}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {Number(lc.exchangeRate).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold text-purple-700">
                    {formatMwk(lc.amountMwkMinor)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
