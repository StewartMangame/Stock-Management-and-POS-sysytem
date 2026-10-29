'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Search,
  RotateCcw,
  Printer,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ArrowLeft,
} from 'lucide-react';
import { formatMwk, parseKwachaToMinor } from '@/lib/money';
import { createCounterReturnAction } from '@/app/(app)/pos/actions';
import { ManagerOverrideModal } from './ManagerOverrideModal';
import Link from 'next/link';
import { toast } from 'sonner';

interface ReturnsClientProps {
  currentShift: any | null;
  currentUser: { id: string; name: string };
}

export function ReturnsClient({ currentShift, currentUser }: ReturnsClientProps) {
  const [receiptNumber, setReceiptNumber] = useState('');
  const [loadingSale, setLoadingSale] = useState(false);
  const [saleData, setSaleData] = useState<any | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Return item quantities: { lineId: returnQty }
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [refundMethod, setRefundMethod] = useState<'cash' | 'card' | 'airtel_money' | 'mpamba'>('cash');
  const [refundReference, setRefundReference] = useState('');
  const [returnReason, setReturnReason] = useState('');

  // Manager Override
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);
  const [overrideData, setOverrideData] = useState<{ pin: string; reason: string } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [completedResult, setCompletedResult] = useState<any | null>(null);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiptNumber.trim()) return;

    setLoadingSale(true);
    setLookupError(null);
    setSaleData(null);
    setReturnQuantities({});
    setCompletedResult(null);

    try {
      const res = await fetch(`/api/pos/sale-lookup?receiptNumber=${encodeURIComponent(receiptNumber.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to find receipt');
      }
      setSaleData(data.sale);
    } catch (err: unknown) {
      setLookupError(err instanceof Error ? err.message : 'Receipt not found');
    } finally {
      setLoadingSale(false);
    }
  };

  // Calculate return total
  const returnLines = Object.entries(returnQuantities)
    .filter(([_, qty]) => qty > 0)
    .map(([lineId, qty]) => {
      const line = saleData.lines.find((l: any) => l.id === lineId);
      const unitPrice = Number(line.unitPriceMinor);
      const tax = Math.round((unitPrice * (line.taxRateBasisPoints || 0)) / 10000);
      return {
        lineId,
        productId: line.productId,
        quantity: qty,
        unitPriceMinor: unitPrice,
        taxMinor: tax,
        lineTotalMinor: (unitPrice + tax) * qty,
      };
    });

  const totalRefundMinor = returnLines.reduce((sum, l) => sum + l.lineTotalMinor, 0);

  const handleSubmitReturn = async () => {
    if (!currentShift) {
      toast.error('You must have an active open shift to process counter returns');
      return;
    }

    if (returnLines.length === 0) {
      toast.error('Please specify at least one item quantity to return');
      return;
    }

    if (!returnReason.trim()) {
      toast.error('A return reason is required');
      return;
    }

    // Check if sale is older than 30 days
    const saleDate = new Date(saleData.createdAt);
    const daysOld = (Date.now() - saleDate.getTime()) / (1000 * 60 * 60 * 24);
    const requiresOverride = daysOld > 30;

    if (requiresOverride && !overrideData) {
      setIsOverrideOpen(true);
      return;
    }

    setSubmitting(true);
    try {
      const res = await createCounterReturnAction({
        invoiceId: saleData.id,
        shiftId: currentShift.id,
        locationId: currentShift.locationId,
        cashierId: currentUser.id,
        refundMethod,
        refundMethodDetails: refundReference ? { reference: refundReference } : undefined,
        notes: returnReason.trim(),
        managerOverride: overrideData || undefined,
        lines: returnLines.map((l) => ({
          sourceLineId: l.lineId,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
          returnGoods: true,
        })),
      });

      setCompletedResult(res);
      toast.success(`Credit Note #${res.creditNote.documentNumber} issued.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to process return');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/pos">
            <Button variant="outline" size="sm" className="h-9 w-9 p-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-ace-navy">Counter Returns & Refunds</h1>
            <p className="text-xs text-muted-foreground">
              Process customer returns, restock inventory, and issue refunds
            </p>
          </div>
        </div>
        {currentShift && (
          <Badge variant="outline" className="text-xs border-ace-sky text-ace-navy">
            Active Shift: #{currentShift.shiftNumber}
          </Badge>
        )}
      </div>

      {!currentShift && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-900 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            You do not have an active open shift. Please open a shift on the POS screen first.
          </span>
        </div>
      )}

      {/* Search Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">1. Look up Original Sale</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLookup} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Enter Invoice / Receipt Number (e.g. MAIN-INV-0001)"
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
                autoFocus
                className="pl-9 h-10 text-sm font-mono"
              />
            </div>
            <Button
              type="submit"
              disabled={loadingSale || !receiptNumber.trim()}
              className="bg-ace-navy hover:bg-ace-navy-deep text-white font-semibold px-5"
            >
              {loadingSale ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Find Sale'}
            </Button>
          </form>

          {lookupError && (
            <div className="mt-3 rounded-md bg-destructive/15 p-3 text-xs font-medium text-destructive">
              {lookupError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sale Details & Return Lines */}
      {saleData && !completedResult && (
        <Card className="border-border">
          <CardHeader className="pb-3 border-b border-border bg-muted/20">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold text-ace-navy">
                  Invoice #{saleData.documentNumber}
                </CardTitle>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                  <span>Customer: <strong className="text-foreground">{saleData.customerName}</strong></span>
                  <span>•</span>
                  <span>Date: {new Date(saleData.createdAt).toLocaleDateString()}</span>
                  <span>•</span>
                  <span>Original Total: <strong className="text-foreground">{formatMwk(saleData.totalMinor)}</strong></span>
                </div>
              </div>
              <Badge variant="outline" className="capitalize text-xs font-semibold">
                {saleData.paymentStatus}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="pt-4 space-y-6">
            {/* Items Table */}
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground uppercase">
                Select Items and Return Quantities
              </Label>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
                    <tr>
                      <th className="py-2.5 px-3 text-left">Product</th>
                      <th className="py-2.5 px-3 text-center">Sold Qty</th>
                      <th className="py-2.5 px-3 text-right">Unit Price</th>
                      <th className="py-2.5 px-3 text-center">Return Qty</th>
                      <th className="py-2.5 px-3 text-right">Refund Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {saleData.lines.map((line: any) => {
                      const maxQty = Number(line.quantity);
                      const currentReturnQty = returnQuantities[line.id] || 0;
                      const lineRefund =
                        (Number(line.unitPriceMinor) + Number(line.taxMinor || 0)) * currentReturnQty;

                      return (
                        <tr key={line.id} className="hover:bg-muted/20">
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-foreground">{line.productName}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {line.sku}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-center font-medium">{maxQty}</td>
                          <td className="py-2.5 px-3 text-right">{formatMwk(line.unitPriceMinor)}</td>
                          <td className="py-2.5 px-3 text-center">
                            <Input
                              type="number"
                              min="0"
                              max={maxQty}
                              value={currentReturnQty || ''}
                              placeholder="0"
                              onChange={(e) => {
                                const val = Math.min(
                                  maxQty,
                                  Math.max(0, parseInt(e.target.value) || 0),
                                );
                                setReturnQuantities({
                                  ...returnQuantities,
                                  [line.id]: val,
                                });
                              }}
                              className="h-8 w-16 text-center font-bold mx-auto text-xs"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-ace-navy">
                            {formatMwk(lineRefund)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Refund Tender Method & Reason */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="refund-method" className="text-xs font-semibold">
                  Refund Method
                </Label>
                <Select
                  value={refundMethod}
                  onValueChange={(val: any) => setRefundMethod(val)}
                >
                  <SelectTrigger id="refund-method" className="h-10 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash (From Drawer)</SelectItem>
                    <SelectItem value="card">Card Reversal / Slip</SelectItem>
                    <SelectItem value="airtel_money">Airtel Money</SelectItem>
                    <SelectItem value="mpamba">TNM Mpamba</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="refund-ref" className="text-xs font-semibold">
                  Refund Reference / Approval (Optional)
                </Label>
                <Input
                  id="refund-ref"
                  placeholder="e.g. Card slip # or mobile reversal ID"
                  value={refundReference}
                  onChange={(e) => setRefundReference(e.target.value)}
                  className="h-10 text-xs"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="return-reason" className="text-xs font-semibold">
                  Reason for Return
                </Label>
                <Input
                  id="return-reason"
                  placeholder="e.g. Defective item / Customer changed mind"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  className="h-10 text-xs"
                />
              </div>
            </div>

            {/* Total Refund Due */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive">
              <span className="font-bold text-sm uppercase tracking-wide">
                Total Refund Amount:
              </span>
              <span className="text-2xl font-black">{formatMwk(totalRefundMinor)}</span>
            </div>

            {/* Process Button */}
            <Button
              type="button"
              disabled={submitting || totalRefundMinor <= 0}
              onClick={handleSubmitReturn}
              className="w-full bg-destructive hover:bg-destructive/90 text-white font-bold h-12 text-sm shadow-md"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing Return & Refund...
                </>
              ) : (
                `Process Return & Refund (${formatMwk(totalRefundMinor)})`
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Completion View */}
      {completedResult && (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">Return Successfully Processed!</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Credit Note #{completedResult.creditNote.documentNumber} issued for{' '}
                <strong className="text-foreground">
                  {formatMwk(completedResult.creditNote.totalMinor)}
                </strong>
                .
              </p>
            </div>

            <div className="flex justify-center gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => window.print()}
                className="text-xs font-semibold h-9"
              >
                <Printer className="mr-1.5 h-3.5 w-3.5" />
                Print Refund Slip
              </Button>
              <Button
                onClick={() => {
                  setCompletedResult(null);
                  setSaleData(null);
                  setReceiptNumber('');
                }}
                className="bg-ace-navy hover:bg-ace-navy-deep text-white text-xs font-semibold h-9"
              >
                Process Another Return
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ManagerOverrideModal
        isOpen={isOverrideOpen}
        onClose={() => setIsOverrideOpen(false)}
        action="pos:out_of_window_return"
        actionLabel="Approve Return Beyond 30-Day Window"
        defaultReason="Out-of-window return approval"
        onSuccess={(_, pin, reason) => {
          setOverrideData({ pin, reason });
          setIsOverrideOpen(false);
          toast.success('Manager override recorded. Ready to submit.');
        }}
      />
    </div>
  );
}
