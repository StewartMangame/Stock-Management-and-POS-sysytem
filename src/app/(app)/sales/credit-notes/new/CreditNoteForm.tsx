'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, RotateCcw, AlertTriangle, PackageCheck } from 'lucide-react';
import { createCreditNoteAction } from '../actions';

export interface InvoiceOptionForCredit {
  id: string;
  documentNumber: string | null;
  customerName: string;
  customerAccount: string;
  locationName: string;
  issueDate: string;
  totalMinor: number;
  balanceMinor: number;
  creditedMinor: number;
  lines: Array<{
    id: string;
    productId: string;
    productName: string;
    sku: string;
    quantity: string;
    deliveredQty: string;
    creditedQty: string;
    unitPriceMinor: number;
    discountMinor: number;
    taxRateBasisPoints: number;
    isSerialized: boolean;
    deliveredSerials: string[];
  }>;
}

interface CreditNoteFormProps {
  invoices: InvoiceOptionForCredit[];
  preselectedInvoiceId?: string;
}

export function CreditNoteForm({ invoices, preselectedInvoiceId }: CreditNoteFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selectedInvoiceId, setSelectedInvoiceId] = useState(
    preselectedInvoiceId && invoices.some((i) => i.id === preselectedInvoiceId)
      ? preselectedInvoiceId
      : invoices[0]?.id || '',
  );

  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('Credit balance applied against customer account.');

  const currentInvoice = invoices.find((inv) => inv.id === selectedInvoiceId);

  // Line states: lineId -> creditQty
  const [creditQuantities, setCreditQuantities] = useState<Record<string, string>>({});

  // Line states: lineId -> returnGoods (boolean)
  const [returnGoodsMap, setReturnGoodsMap] = useState<Record<string, boolean>>({});

  // Line states: lineId -> selected serial strings
  const [returnedSerials, setReturnedSerials] = useState<Record<string, string[]>>({});

  function handleInvoiceChange(invId: string) {
    setSelectedInvoiceId(invId);
    setCreditQuantities({});
    setReturnGoodsMap({});
    setReturnedSerials({});
  }

  function handleQuantityChange(lineId: string, val: string) {
    setCreditQuantities((prev) => ({ ...prev, [lineId]: val }));
  }

  function handleReturnGoodsToggle(lineId: string, val: boolean) {
    setReturnGoodsMap((prev) => ({ ...prev, [lineId]: val }));
    if (!val) {
      setReturnedSerials((prev) => ({ ...prev, [lineId]: [] }));
    }
  }

  function toggleSerial(lineId: string, serial: string) {
    setReturnedSerials((prev) => {
      const current = prev[lineId] || [];
      if (current.includes(serial)) {
        return { ...prev, [lineId]: current.filter((s) => s !== serial) };
      } else {
        return { ...prev, [lineId]: [...current, serial] };
      }
    });
  }

  // Calculate live preview total credit amount
  let totalCreditMinor = 0;
  if (currentInvoice) {
    for (const line of currentInvoice.lines) {
      const q = parseFloat(creditQuantities[line.id] || '0');
      if (q > 0) {
        const gross = q * line.unitPriceMinor;
        const origQty = parseFloat(line.quantity) || 1;
        const discountFraction = (line.discountMinor / origQty) * q;
        const net = Math.max(0, gross - discountFraction);
        const tax = Math.round((net * line.taxRateBasisPoints) / 10000);
        totalCreditMinor += Math.round(net + tax);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedInvoiceId || !currentInvoice) {
      toast.error('Please select an invoice');
      return;
    }

    const linesToCredit: Array<{
      sourceLineId: string;
      quantity: number;
      unitPriceMinor?: number;
      discountMinor?: number;
      returnGoods: boolean;
      serialNumbers?: string[];
      notes?: string;
    }> = [];

    for (const line of currentInvoice.lines) {
      const qty = parseFloat(creditQuantities[line.id] || '0');
      if (qty <= 0) continue;

      const totalQty = parseFloat(line.quantity);
      const creditedQty = parseFloat(line.creditedQty);
      const remainingCreditable = Math.max(0, totalQty - creditedQty);

      if (qty > remainingCreditable) {
        toast.error(`Credit quantity for ${line.productName} exceeds remaining creditable (${remainingCreditable})`);
        return;
      }

      const returnGoods = returnGoodsMap[line.id] ?? false;
      const deliveredQty = parseFloat(line.deliveredQty);

      if (returnGoods && qty > deliveredQty) {
        toast.error(
          `Cannot return ${qty} units of ${line.productName} to stock; only ${deliveredQty} unit(s) were delivered.`,
        );
        return;
      }

      if (returnGoods && line.isSerialized) {
        const serials = returnedSerials[line.id] || [];
        if (serials.length !== qty) {
          toast.error(
            `Line ${line.productName} has 'Return Goods' enabled and requires selecting exactly ${qty} returned serial number(s) (currently selected: ${serials.length}).`,
          );
          return;
        }
      }

      linesToCredit.push({
        sourceLineId: line.id,
        quantity: qty,
        returnGoods,
        serialNumbers: returnGoods && line.isSerialized ? returnedSerials[line.id] : undefined,
      });
    }

    if (linesToCredit.length === 0) {
      toast.error('Please enter a credit quantity greater than 0 for at least one line');
      return;
    }

    startTransition(async () => {
      try {
        const payload = {
          invoiceId: selectedInvoiceId,
          issueDate,
          notes: notes || undefined,
          terms: terms || undefined,
          lines: linesToCredit,
        };

        const res = await createCreditNoteAction(payload);
        toast.success(`Credit Note ${res.creditNote.documentNumber} issued successfully!`);
        router.push(`/sales/credit-notes/${res.creditNote.id}`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to issue credit note');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 gap-1">
            <Link href="/sales/credit-notes">
              <ArrowLeft className="h-4 w-4" /> Back to Credit Notes
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ace-navy">Issue Credit Note</h1>
            <p className="text-xs text-muted-foreground">
              Credit sales invoice lines, process physical returns to stock, or release undelivered stock reservations.
            </p>
          </div>
        </div>

        <Button
          type="submit"
          disabled={isPending || !currentInvoice}
          className="bg-ace-gold text-ace-navy hover:bg-ace-gold/90 font-bold shadow-sm"
        >
          {isPending ? 'Issuing...' : 'Issue Credit Note'}
        </Button>
      </div>

      {/* Invoice Select Card */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-ace-navy">Invoice & Credit Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-semibold">
              Select Source Invoice <span className="text-rose-500">*</span>
            </Label>
            <Select value={selectedInvoiceId} onValueChange={handleInvoiceChange}>
              <SelectTrigger className="bg-card">
                <SelectValue placeholder="Select issued invoice..." />
              </SelectTrigger>
              <SelectContent>
                {invoices.map((inv) => (
                  <SelectItem key={inv.id} value={inv.id}>
                    {inv.documentNumber || 'Draft'} — {inv.customerName} (Bal: MWK {(inv.balanceMinor / 100).toFixed(2)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Credit Issue Date</Label>
            <Input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="bg-card"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Current Invoice Balance</Label>
            <div className="h-9 flex items-center px-3 rounded-md border bg-muted/30 font-mono text-xs font-semibold">
              MWK {currentInvoice ? (currentInvoice.balanceMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 }) : '0.00'}
            </div>
          </div>

          <div className="space-y-1.5 md:col-span-4">
            <Label className="text-xs font-semibold">Reason for Credit / Notes</Label>
            <Input
              placeholder="e.g. Returned damaged item on delivery; pricing adjustment"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-card"
            />
          </div>
        </CardContent>
      </Card>

      {/* Creditable Lines Card */}
      {currentInvoice && (
        <Card className="shadow-sm">
          <CardHeader className="pb-3 bg-muted/20 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold text-ace-navy">
              Creditable Items for Invoice {currentInvoice.documentNumber}
            </CardTitle>
            <div className="text-xs font-bold text-ace-navy">
              Estimated Credit: MWK {(totalCreditMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/10">
                <TableRow>
                  <TableHead className="w-[28%]">Product / SKU</TableHead>
                  <TableHead className="w-[10%] text-right">Invoiced</TableHead>
                  <TableHead className="w-[10%] text-right">Delivered</TableHead>
                  <TableHead className="w-[10%] text-right">Credited</TableHead>
                  <TableHead className="w-[14%] text-right font-bold text-ace-navy">Qty to Credit</TableHead>
                  <TableHead className="w-[14%] text-center">Return Goods?</TableHead>
                  <TableHead className="w-[14%]">Serial Return</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentInvoice.lines.map((line) => {
                  const invQty = parseFloat(line.quantity);
                  const delQty = parseFloat(line.deliveredQty);
                  const crQty = parseFloat(line.creditedQty);
                  const remaining = Math.max(0, invQty - crQty);
                  const currentCredit = parseFloat(creditQuantities[line.id] || '0');
                  const isReturn = returnGoodsMap[line.id] ?? false;

                  return (
                    <TableRow key={line.id}>
                      <TableCell>
                        <div className="font-semibold text-foreground">{line.productName}</div>
                        <div className="text-xs font-mono text-muted-foreground">
                          SKU: {line.sku} • Unit Price: MWK {(line.unitPriceMinor / 100).toFixed(2)}
                        </div>
                      </TableCell>

                      <TableCell className="text-right font-mono text-xs">
                        {invQty.toLocaleString()}
                      </TableCell>

                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {delQty.toLocaleString()}
                      </TableCell>

                      <TableCell className="text-right font-mono text-xs text-rose-600">
                        {crQty.toLocaleString()}
                      </TableCell>

                      <TableCell>
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          max={remaining}
                          disabled={remaining <= 0}
                          value={creditQuantities[line.id] || '0'}
                          onChange={(e) => handleQuantityChange(line.id, e.target.value)}
                          className="text-right font-mono font-semibold text-xs bg-card"
                        />
                      </TableCell>

                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Switch
                            checked={isReturn}
                            disabled={currentCredit <= 0 || delQty <= 0}
                            onCheckedChange={(val) => handleReturnGoodsToggle(line.id, val)}
                          />
                          <span className="text-[10px] text-muted-foreground">
                            {isReturn ? 'Restock' : 'Credit Only'}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell>
                        {isReturn && line.isSerialized && currentCredit > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] font-semibold text-foreground">
                              Select {currentCredit} serial(s):
                            </span>
                            <div className="max-h-24 overflow-y-auto rounded border p-1 bg-muted/20 space-y-1">
                              {line.deliveredSerials.length === 0 ? (
                                <p className="text-[10px] text-rose-600">No sold serials found</p>
                              ) : (
                                line.deliveredSerials.map((s) => {
                                  const isChecked = (returnedSerials[line.id] || []).includes(s);
                                  return (
                                    <label
                                      key={s}
                                      className="flex items-center gap-1.5 text-xs font-mono cursor-pointer hover:bg-muted/40 p-0.5 rounded"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleSerial(line.id, s)}
                                        className="rounded border-gray-300 text-ace-navy"
                                      />
                                      {s}
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        )}
                        {(!isReturn || !line.isSerialized) && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </form>
  );
}
