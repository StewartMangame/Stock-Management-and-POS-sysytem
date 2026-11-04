'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Download,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Calendar,
  Clock,
  ShieldCheck,
  Truck,
  RotateCcw,
  FileCheck,
  Lock,
  CreditCard,
} from 'lucide-react';
import { issueInvoiceAction, voidInvoiceAction } from '../actions';
import { EntityHistoryTab } from '@/components/shared/EntityHistoryTab';

interface InvoiceDetailProps {
  invoice: {
    allocations?: Array<{
      id: string;
      paymentId: string;
      amountMinor: number;
      allocatedAt: string;
      paymentNumber: string;
      paymentMethod: string;
      paymentStatus: string;
    }>;
    id: string;
    documentNumber: string | null;
    status: 'draft' | 'issued' | 'void';
    deliveryStatus: 'not_delivered' | 'partly_delivered' | 'delivered';
    paymentStatus: 'unpaid' | 'partly_paid' | 'paid';
    issueDate: string;
    dueDate: string;
    currency: string;
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
    creditedMinor: number;
    paidMinor: number;
    balanceMinor: number;
    notes: string | null;
    terms: string | null;
    isImmutable: boolean;
    voidedAt: string | null;
    voidReason: string | null;
    approvedAt: string | null;
    approvalReason: string | null;
    eisStatus: string;
    createdAt: string;
    customer: {
      id: string;
      name: string;
      accountNumber: string;
      email: string | null;
      phone: string | null;
      taxNumber: string | null;
      creditLimitMinor: number;
      isWalkIn: boolean;
    };
    location: {
      id: string;
      name: string;
      code: string;
    };
    createdByUser?: {
      name: string;
    } | null;
    sourceQuotation?: {
      id: string;
      quotationNumber: string | null;
    } | null;
    lines: Array<{
      id: string;
      sku: string;
      description: string | null;
      quantity: string;
      deliveredQty: string;
      creditedQty: string;
      unitPriceMinor: number;
      discountMinor: number;
      taxRateBasisPoints: number;
      taxMinor: number;
      lineTotalMinor: number;
      notes: string | null;
      productName: string;
    }>;
    deliveryNotes: Array<{
      id: string;
      deliveryNumber: string;
      deliveryDate: string;
      status: string;
      receivedByCustomer: string | null;
    }>;
    creditNotes: Array<{
      id: string;
      documentNumber: string | null;
      issueDate: string;
      totalMinor: number;
      status: string;
    }>;
    reservations: Array<{
      id: string;
      productName: string;
      sku: string;
      reservedQty: string;
      status: string;
      expiresAt: string | null;
    }>;
  };
}

export function InvoiceDetailClient({ invoice: inv }: InvoiceDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [managerApprovalOpen, setManagerApprovalOpen] = useState(false);
  const [approvalReason, setApprovalReason] = useState('');
  const [pendingError, setPendingError] = useState('');

  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const isOverdue =
    inv.paymentStatus !== 'paid' &&
    inv.status === 'issued' &&
    new Date(inv.dueDate).getTime() < Date.now();

  function handleIssue(options?: { managerApproved?: boolean; approvalReason?: string }) {
    startTransition(async () => {
      try {
        const res = await issueInvoiceAction(inv.id, options);
        toast.success(`Invoice issued! Number assigned: ${res.invoice.documentNumber}`);
        setManagerApprovalOpen(false);
        router.refresh();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to issue invoice';
        if (message.includes('Manager approval required')) {
          setPendingError(message);
          setManagerApprovalOpen(true);
        } else {
          toast.error(message);
        }
      }
    });
  }

  function handleVoid() {
    startTransition(async () => {
      try {
        await voidInvoiceAction(inv.id, voidReason);
        toast.success('Invoice voided. Active stock reservations were released.');
        setVoidDialogOpen(false);
        router.refresh();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to void invoice');
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 gap-1">
            <Link href="/sales/invoices">
              <ArrowLeft className="h-4 w-4" /> Back to Invoices
            </Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-ace-navy">
                Invoice {inv.documentNumber || 'DRAFT'}
              </h1>

              {/* Status Badge */}
              <Badge
                variant="outline"
                className={`capitalize font-semibold text-xs ${
                  inv.status === 'issued'
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : inv.status === 'void'
                    ? 'bg-rose-50 text-rose-700 border-rose-200 line-through'
                    : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                {inv.status}
              </Badge>

              {/* Delivery Status Badge */}
              <Badge
                variant="outline"
                className={`text-xs capitalize ${
                  inv.deliveryStatus === 'delivered'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : inv.deliveryStatus === 'partly_delivered'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-gray-50 text-gray-600 border-gray-200'
                }`}
              >
                {inv.deliveryStatus.replace('_', ' ')}
              </Badge>

              {/* Payment Status Badge */}
              <Badge
                variant="outline"
                className={`text-xs capitalize ${
                  inv.paymentStatus === 'paid'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : inv.paymentStatus === 'partly_paid'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                }`}
              >
                {inv.paymentStatus.replace('_', ' ')}
              </Badge>

              {isOverdue && (
                <Badge variant="destructive" className="text-xs">
                  Overdue
                </Badge>
              )}
            </div>

            <p className="text-xs text-muted-foreground mt-0.5">
              Created {new Date(inv.createdAt).toLocaleDateString()} by {inv.createdByUser?.name || 'System'}
              {inv.sourceQuotation && (
                <>
                  {' '}• Converted from Quotation{' '}
                  <Link
                    href={`/sales/quotations/${inv.sourceQuotation.id}`}
                    className="font-mono text-ace-navy hover:underline"
                  >
                    {inv.sourceQuotation.quotationNumber || 'Draft'}
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 shadow-sm">
            <a href={`/api/pdf/invoice/${inv.id}`} target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" /> Download PDF
            </a>
          </Button>

          {inv.status === 'draft' && (
            <Button
              onClick={() => handleIssue()}
              disabled={isPending}
              size="sm"
              className="h-9 gap-1.5 bg-ace-navy text-white hover:bg-ace-navy/90 font-semibold shadow-sm"
            >
              <CheckCircle2 className="h-4 w-4" /> Issue Invoice
            </Button>
          )}

          {inv.status === 'issued' && (
            <>
              {inv.deliveryStatus !== 'delivered' && (
                <Button asChild size="sm" className="h-9 gap-1.5 bg-ace-navy text-white hover:bg-ace-navy/90 font-semibold shadow-sm">
                  <Link href={`/sales/delivery-notes/new?invoiceId=${inv.id}`}>
                    <Truck className="h-4 w-4" /> Dispatch Delivery
                  </Link>
                </Button>
              )}

              <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 shadow-sm">
                <Link href={`/sales/credit-notes/new?invoiceId=${inv.id}`}>
                  <RotateCcw className="h-4 w-4" /> Issue Credit Note
                </Link>
              </Button>

              {inv.balanceMinor > 0 && (
                <Button asChild size="sm" className="h-9 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 font-semibold shadow-sm">
                  <Link href={`/sales/payments/new?customerId=${inv.customer.id}&invoiceId=${inv.id}`}>
                    <CreditCard className="h-4 w-4" /> Record Payment
                  </Link>
                </Button>
              )}

              {inv.deliveryStatus === 'not_delivered' && (
                <Button
                  onClick={() => setVoidDialogOpen(true)}
                  disabled={isPending}
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5 text-rose-600 hover:bg-rose-50 border-rose-200 shadow-sm"
                >
                  <AlertTriangle className="h-4 w-4" /> Void Invoice
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Meta Grid */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> Customer Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <Link
              href={`/sales/customers/${inv.customer.id}`}
              className="text-base font-bold text-ace-navy hover:underline"
            >
              {inv.customer.name}
            </Link>
            <div className="text-xs font-mono text-muted-foreground">
              Account: {inv.customer.accountNumber} {inv.customer.isWalkIn ? '• Walk-in' : ''}
            </div>
            {inv.customer.taxNumber && (
              <div className="text-xs text-muted-foreground">TPIN: {inv.customer.taxNumber}</div>
            )}
            {inv.customer.phone && (
              <div className="text-xs text-muted-foreground">Tel: {inv.customer.phone}</div>
            )}
            {inv.customer.email && (
              <div className="text-xs text-muted-foreground">Email: {inv.customer.email}</div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Schedule & Branch
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Branch:</span>
              <span className="font-semibold">{inv.location.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Issue Date:</span>
              <span className="font-mono">{new Date(inv.issueDate).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Due Date:</span>
              <span className="font-mono font-semibold text-foreground">
                {new Date(inv.dueDate).toLocaleDateString()}
              </span>
            </div>
            {inv.isImmutable && (
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
                <Lock className="h-3 w-3 text-emerald-600" /> Database Immutability Enforced
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm bg-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Financial Balance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Invoiced:</span>
              <span className="font-mono font-semibold">
                MWK {(inv.totalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
              </span>
            </div>
            {inv.creditedMinor > 0 && (
              <div className="flex justify-between text-rose-600">
                <span>Credit Notes:</span>
                <span className="font-mono">
                  - MWK {(inv.creditedMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
            {inv.paidMinor > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Payments Received:</span>
                <span className="font-mono">
                  - MWK {(inv.paidMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
            <div className="border-t pt-1.5 flex justify-between text-sm font-bold text-ace-navy">
              <span>Outstanding Balance:</span>
              <span className="font-mono">
                MWK {(inv.balanceMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Line Items Table */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 pb-3">
          <CardTitle className="text-sm font-bold text-ace-navy">Line Items ({inv.lines.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow>
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>Product / Description</TableHead>
                <TableHead className="text-right">Qty Invoiced</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Credited</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right font-semibold">Line Total (MWK)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inv.lines.map((line, idx) => (
                <TableRow key={line.id}>
                  <TableCell className="text-center font-mono text-xs text-muted-foreground">
                    {idx + 1}
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-foreground">{line.productName}</div>
                    <div className="text-xs font-mono text-muted-foreground">SKU: {line.sku}</div>
                    {line.notes && <div className="text-xs text-muted-foreground mt-0.5">{line.notes}</div>}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    {parseFloat(line.quantity).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-emerald-700">
                    {parseFloat(line.deliveredQty).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-rose-600">
                    {parseFloat(line.creditedQty).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {(line.unitPriceMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {line.discountMinor > 0
                      ? (line.discountMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {(line.taxMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold text-foreground">
                    {(line.lineTotalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Related Delivery Notes & Credit Notes */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Delivery Notes */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3 bg-muted/10 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold text-ace-navy flex items-center gap-2">
              <Truck className="h-4 w-4" /> Dispatched Delivery Notes ({inv.deliveryNotes.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {inv.deliveryNotes.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No deliveries have been dispatched for this invoice yet.
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/10">
                  <TableRow>
                    <TableHead>Delivery Note #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Received By</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inv.deliveryNotes.map((dn) => (
                    <TableRow key={dn.id}>
                      <TableCell className="font-mono text-xs font-semibold text-ace-navy">
                        <Link href={`/sales/delivery-notes/${dn.id}`} className="hover:underline">
                          {dn.deliveryNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs">
                        {new Date(dn.deliveryDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {dn.receivedByCustomer || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                          <Link href={`/sales/delivery-notes/${dn.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Credit Notes */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3 bg-muted/10 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold text-ace-navy flex items-center gap-2">
              <RotateCcw className="h-4 w-4" /> Credit Notes Issued ({inv.creditNotes.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {inv.creditNotes.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No credit notes have been issued against this invoice.
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/10">
                  <TableRow>
                    <TableHead>Credit Note #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount (MWK)</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inv.creditNotes.map((cn) => (
                    <TableRow key={cn.id}>
                      <TableCell className="font-mono text-xs font-semibold text-ace-navy">
                        <Link href={`/sales/credit-notes/${cn.id}`} className="hover:underline">
                          {cn.documentNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs">
                        {new Date(cn.issueDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-rose-600 font-semibold">
                        {(cn.totalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                          <Link href={`/sales/credit-notes/${cn.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payments and Allocations */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3 bg-muted/10 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold text-ace-navy flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-emerald-600" /> Payments & Allocations ({(inv.allocations || []).length})
          </CardTitle>
          {inv.status === 'issued' && inv.balanceMinor > 0 && (
            <Button asChild variant="outline" size="sm" className="h-7 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
              <Link href={`/sales/payments/new?customerId=${inv.customer.id}&invoiceId=${inv.id}`}>
                + Allocate Payment
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {(inv.allocations || []).length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No payments have been allocated to this invoice yet.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/10">
                <TableRow>
                  <TableHead>Payment #</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Allocated Date</TableHead>
                  <TableHead className="text-right">Allocated Amount</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.allocations?.map((alloc) => (
                  <TableRow key={alloc.id}>
                    <TableCell className="font-mono text-xs font-semibold text-ace-navy">
                      <Link href={`/sales/payments/${alloc.paymentId}`} className="hover:underline">
                        {alloc.paymentNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize text-xs">
                      {alloc.paymentMethod.replace('_', ' ')}
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(alloc.allocatedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-emerald-600">
                      MWK {(alloc.amountMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="capitalize text-[10px]">
                        {alloc.paymentStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                        <Link href={`/sales/payments/${alloc.paymentId}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Active Reservations */}
      {inv.reservations.length > 0 && (
        <Card className="shadow-sm border-blue-200 bg-blue-50/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-blue-900 flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-600" /> Undelivered Stock Reservations
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-blue-100/40">
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Reserved Qty</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.reservations.map((res) => (
                  <TableRow key={res.id}>
                    <TableCell className="font-semibold text-foreground">{res.productName}</TableCell>
                    <TableCell className="font-mono text-xs">{res.sku}</TableCell>
                    <TableCell className="text-right font-mono font-semibold text-blue-700">
                      {parseFloat(res.reservedQty).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="capitalize text-xs bg-blue-50 text-blue-700 border-blue-300">
                        {res.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Audit History Timeline */}
      <EntityHistoryTab entityType="sales_document" entityId={inv.id} />

      {/* Void Dialog */}
      <Dialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <AlertTriangle className="h-5 w-5" /> Void Sales Invoice
            </DialogTitle>
            <DialogDescription>
              Voiding this invoice will cancel the outstanding balance and release any held stock reservations.
              This operation cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-2">
            <label className="text-xs font-semibold">Reason for Voiding</label>
            <Textarea
              placeholder="Provide reason for voiding invoice..."
              value={voidReason}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setVoidReason(e.target.value)}
              className="text-xs"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidDialogOpen(false)}>
              Back
            </Button>
            <Button
              variant="destructive"
              onClick={handleVoid}
              disabled={isPending}
              className="font-semibold"
            >
              {isPending ? 'Voiding...' : 'Yes, Void Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manager Approval Modal */}
      <Dialog open={managerApprovalOpen} onOpenChange={setManagerApprovalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <ShieldCheck className="h-5 w-5" /> Manager Approval Required
            </DialogTitle>
            <DialogDescription className="text-foreground text-xs mt-2">
              {pendingError}
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-2">
            <label className="text-xs font-semibold">
              Approval Justification / Authorization Note <span className="text-rose-500">*</span>
            </label>
            <Textarea
              placeholder="e.g. Authorized by Branch Manager for VIP customer corporate contract"
              value={approvalReason}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setApprovalReason(e.target.value)}
              className="text-xs"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setManagerApprovalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handleIssue({ managerApproved: true, approvalReason })}
              disabled={isPending || !approvalReason.trim()}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
            >
              {isPending ? 'Submitting...' : 'Authorize & Issue Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
