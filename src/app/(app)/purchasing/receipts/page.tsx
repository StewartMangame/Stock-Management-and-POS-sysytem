import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { listGoodsReceipts } from '@/server/services/purchasing/goods-receipts';
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
import { Plus, Eye, Truck } from 'lucide-react';

export const metadata: Metadata = { title: 'Goods Received Notes (GRN) | Ace Holdings POS' };

export default async function GoodsReceiptsPage() {
  try {
    await authorize(PERMISSIONS.PURCHASE_ORDERS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const receipts = await listGoodsReceipts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Goods Received Notes (GRN)</h1>
          <p className="text-sm text-ace-muted">
            Warehouse intake records with multi-cost landed cost allocation and serial capture.
          </p>
        </div>
        <Link href="/purchasing/receipts/new">
          <Button id="new-grn-btn">
            <Plus className="mr-2 h-4 w-4" />
            New Goods Receipt
          </Button>
        </Link>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>GRN Number</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>PO Reference</TableHead>
              <TableHead>Invoice #</TableHead>
              <TableHead className="text-right">Items (MWK)</TableHead>
              <TableHead className="text-right">Landed Cost (MWK)</TableHead>
              <TableHead className="text-right">Total MWK</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-center text-ace-muted">
                  <div className="flex flex-col items-center justify-center gap-1">
                    <Truck className="h-6 w-6 text-gray-400" />
                    <p>No goods receipts recorded yet.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              receipts.map((grn) => {
                const totalMwk = grn.totalItemsMwkMinor + grn.totalLandedMwkMinor;
                return (
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
                    <TableCell className="text-sm font-medium">
                      {grn.supplier?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-ace-muted">
                      {grn.location?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {grn.purchaseOrder ? (
                        <Link
                          href={`/purchasing/orders/${grn.purchaseOrder.id}`}
                          className="hover:underline text-ace-blue"
                        >
                          {grn.purchaseOrder.poNumber}
                        </Link>
                      ) : (
                        <span className="text-gray-400">Direct / Ad-hoc</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-ace-muted font-mono">
                      {grn.supplierInvoiceNumber || '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatMwk(grn.totalItemsMwkMinor)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-purple-700">
                      {formatMwk(grn.totalLandedMwkMinor)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold text-ace-navy">
                      {formatMwk(totalMwk)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/purchasing/receipts/${grn.id}`}>
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
