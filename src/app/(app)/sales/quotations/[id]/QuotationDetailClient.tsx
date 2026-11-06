'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  Printer,
  Send,
  CheckCircle2,
  XCircle,
  FileCheck,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import {
  sendQuotationAction,
  acceptQuotationAction,
  cancelQuotationAction,
  convertQuotationToInvoiceAction,
  extendQuotationReservationAction,
} from '../actions';
import { QuotationDocumentView } from '@/components/quotations/QuotationDocumentView';

interface QuotationDetailProps {
  quotation: {
    id: string;
    quotationNumber: string | null;
    status: string;
    quotationDate: string;
    validUntil: string;
    currency: string;
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
    notes: string | null;
    terms: string | null;
    createdAt: string;
    customer: {
      id: string;
      name: string;
      accountNumber: string;
      address?: string | null;
      email: string | null;
      phone: string | null;
      taxNumber: string | null;
      creditLimitMinor: number;
    };
    location: {
      id: string;
      name: string;
      code: string;
    };
    createdByUser?: {
      id: string;
      name: string;
    } | null;
    lines: Array<{
      id: string;
      sku: string;
      description: string | null;
      quantity: string;
      unitPriceMinor: number;
      discountMinor: number;
      taxRateBasisPoints: number;
      taxMinor: number;
      lineTotalMinor: number;
      notes: string | null;
      productName: string;
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

export function QuotationDetailClient({ quotation: q }: QuotationDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);
  const [allowShortfall, setAllowShortfall] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const isExpired = new Date(q.validUntil).getTime() < Date.now();

  function handleSend() {
    startTransition(async () => {
      try {
        const res = await sendQuotationAction(q.id);
        toast.success(`Quotation sent! Number assigned: ${res.quotation.quotationNumber}`);
        router.refresh();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to send quotation');
      }
    });
  }

  function handleAccept() {
    startTransition(async () => {
      try {
        await acceptQuotationAction(q.id, { allowShortfallPartial: allowShortfall });
        toast.success('Quotation accepted! Stock has been reserved.');
        setAcceptDialogOpen(false);
        router.refresh();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to accept quotation');
      }
    });
  }

  function handleCancel() {
    startTransition(async () => {
      try {
        await cancelQuotationAction(q.id);
        toast.success('Quotation cancelled. Any active stock reservations were released.');
        setCancelDialogOpen(false);
        router.refresh();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to cancel quotation');
      }
    });
  }

  function handleConvert() {
    startTransition(async () => {
      try {
        const res = await convertQuotationToInvoiceAction(q.id);
        toast.success('Quotation converted to draft invoice successfully!');
        router.push(`/sales/invoices/${res.invoice.id}`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to convert to invoice');
      }
    });
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="space-y-6">
      {/* Top Action Header Toolbar (hidden when printing) */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between no-print">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 gap-1">
            <Link href="/sales/quotations">
              <ArrowLeft className="h-4 w-4" /> Back to Quotations
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-ace-navy">
                Quotation {q.quotationNumber || 'DRAFT'}
              </h1>
              <Badge
                variant="outline"
                className={`capitalize font-semibold text-xs ${
                  q.status === 'accepted'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : q.status === 'converted'
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : q.status === 'sent'
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : q.status === 'expired' || q.status === 'cancelled'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                {q.status}
              </Badge>
              {isExpired && q.status === 'sent' && (
                <Badge variant="destructive" className="text-xs">
                  Expired Validity
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Created {new Date(q.createdAt).toLocaleDateString()} by {q.createdByUser?.name || 'System'} | Location: {q.location.name}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handlePrint}
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 shadow-sm"
          >
            <Printer className="h-4 w-4" /> Print
          </Button>

          <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 shadow-sm">
            <a href={`/api/pdf/quotation/${q.id}`} target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" /> Download PDF
            </a>
          </Button>

          {q.status === 'draft' && (
            <Button
              onClick={handleSend}
              disabled={isPending}
              size="sm"
              className="h-9 gap-1.5 bg-ace-navy text-white hover:bg-ace-navy/90 font-semibold shadow-sm"
            >
              <Send className="h-4 w-4" /> Send Quotation
            </Button>
          )}

          {q.status === 'sent' && (
            <>
              <Button
                onClick={() => setCancelDialogOpen(true)}
                disabled={isPending}
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-rose-600 hover:bg-rose-50 border-rose-200 shadow-sm"
              >
                <XCircle className="h-4 w-4" /> Cancel Quotation
              </Button>
              <Button
                onClick={() => setAcceptDialogOpen(true)}
                disabled={isPending}
                size="sm"
                className="h-9 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 font-semibold shadow-sm"
              >
                <CheckCircle2 className="h-4 w-4" /> Accept Quotation
              </Button>
            </>
          )}

          {q.status === 'accepted' && (
            <Button
              onClick={handleConvert}
              disabled={isPending}
              size="sm"
              className="h-9 gap-1.5 bg-ace-gold text-ace-navy hover:bg-ace-gold/90 font-bold shadow-sm"
            >
              <FileCheck className="h-4 w-4" /> Convert to Invoice
            </Button>
          )}
        </div>
      </div>

      {/* Active Reservations (if accepted) */}
      {q.reservations.length > 0 && (
        <Card className="shadow-sm border-emerald-200 bg-emerald-50/20 no-print">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold text-emerald-800 flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-600" /> Active Stock Reservations
            </CardTitle>
            {q.status === 'accepted' && q.reservations.some((r) => r.status === 'active') && (
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    try {
                      await extendQuotationReservationAction(q.id, 14);
                      toast.success('Reservation hold extended by 14 days!');
                      router.refresh();
                    } catch (err: unknown) {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : 'Failed to extend reservation hold',
                      );
                    }
                  });
                }}
                className="h-7 text-xs border-emerald-300 text-emerald-800 hover:bg-emerald-100"
              >
                Extend Hold (+14 Days)
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-emerald-100/40">
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Reserved Qty</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Expires At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.reservations.map((res) => (
                  <TableRow key={res.id}>
                    <TableCell className="font-semibold text-foreground">{res.productName}</TableCell>
                    <TableCell className="font-mono text-xs">{res.sku}</TableCell>
                    <TableCell className="text-right font-mono font-semibold text-emerald-700">
                      {parseFloat(res.reservedQty).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className="capitalize text-xs bg-emerald-50 text-emerald-700 border-emerald-300"
                      >
                        {res.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {res.expiresAt ? new Date(res.expiresAt).toLocaleString() : 'No expiry'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Main Quotation Letterhead Document Canvas */}
      <div className="py-2">
        <QuotationDocumentView quotation={q} className="shadow-lg" />
      </div>

      {/* Accept Dialog */}
      <Dialog open={acceptDialogOpen} onOpenChange={setAcceptDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept Quotation</DialogTitle>
            <DialogDescription>
              Accepting this quotation will allocate and reserve current branch inventory for all line items
              (and components for bundled products) until expiration.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <label className="flex items-start gap-2.5 cursor-pointer text-xs text-muted-foreground bg-muted/40 p-3 rounded-lg border">
              <input
                type="checkbox"
                checked={allowShortfall}
                onChange={(e) => setAllowShortfall(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-ace-navy focus:ring-ace-navy"
              />
              <div>
                <span className="font-semibold text-foreground">
                  Allow partial reservation on stock shortfall
                </span>
                <p className="mt-0.5">
                  If any product does not have enough unreserved stock, reserve what is available and proceed
                  without throwing a stock shortfall error.
                </p>
              </div>
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAcceptDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAccept}
              disabled={isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              {isPending ? 'Reserving...' : 'Confirm Acceptance'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <AlertTriangle className="h-5 w-5" /> Cancel Quotation
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel Quotation {q.quotationNumber}? This action cannot be undone.
              Any active stock reservations held for this quotation will be immediately released back to available inventory.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
              Back
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={isPending}
              className="font-semibold"
            >
              {isPending ? 'Cancelling...' : 'Yes, Cancel Quotation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
