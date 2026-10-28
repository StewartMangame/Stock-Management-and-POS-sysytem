'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Trash2, Plus, ArrowLeft, Calculator, Building2 } from 'lucide-react';
import { createDirectInvoiceAction } from '../actions';
import { calculateDocumentTotals } from '@/lib/sales-math';

interface CustomerOption {
  id: string;
  name: string;
  accountNumber: string;
  isWalkIn: boolean;
  creditLimitMinor: number;
  paymentTermsDays: number;
}

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  sellingPriceMinor: number;
  avgCostMinor: number;
  taxRateId?: string | null;
  taxBasisPoints?: number;
}

interface LocationOption {
  id: string;
  name: string;
}

interface InvoiceFormProps {
  customers: CustomerOption[];
  products: ProductOption[];
  locations: LocationOption[];
  defaultTaxRateId: string;
}

interface FormLine {
  productId: string;
  quantity: string;
  unitPriceMwk: string;
  discountMwk: string;
}

export function InvoiceForm({
  customers,
  products,
  locations,
  defaultTaxRateId,
}: InvoiceFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [customerId, setCustomerId] = useState('');
  const [locationId, setLocationId] = useState(locations[0]?.id || '');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('Payment due as per agreed payment terms. Goods remain Ace Holdings property until fully paid.');

  const [lines, setLines] = useState<FormLine[]>([
    { productId: '', quantity: '1', unitPriceMwk: '', discountMwk: '0' },
  ]);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  // When customer changes, update due date based on payment terms
  function handleCustomerSelect(cId: string) {
    setCustomerId(cId);
    const cust = customers.find((c) => c.id === cId);
    if (cust) {
      const days = cust.paymentTermsDays || 30;
      const baseDate = new Date(issueDate);
      const computedDue = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
      setDueDate(computedDue.toISOString().slice(0, 10));
    }
  }

  const prodMap = new Map(products.map((p) => [p.id, p]));

  function handleProductChange(index: number, pId: string) {
    const prod = prodMap.get(pId);
    setLines((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index]!,
        productId: pId,
        unitPriceMwk: prod ? (prod.sellingPriceMinor / 100).toFixed(2) : '',
      };
      return next;
    });
  }

  function handleLineChange(index: number, field: keyof FormLine, value: string) {
    setLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index]!, [field]: value };
      return next;
    });
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { productId: '', quantity: '1', unitPriceMwk: '', discountMwk: '0' },
    ]);
  }

  function removeLine(index: number) {
    if (lines.length === 1) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  // Live totals preview
  const mathLines = lines
    .filter((l) => l.productId && parseFloat(l.quantity) > 0)
    .map((l) => {
      const p = prodMap.get(l.productId);
      const unitPriceMinor = Math.round((parseFloat(l.unitPriceMwk) || 0) * 100);
      const discountMinor = Math.round((parseFloat(l.discountMwk) || 0) * 100);
      return {
        quantity: l.quantity,
        unitPriceMinor,
        discountMinor,
        taxRateBasisPoints: p?.taxBasisPoints ?? 1750,
      };
    });

  const totals = calculateDocumentTotals(mathLines);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!customerId) {
      toast.error('Please select a customer');
      return;
    }
    if (!locationId) {
      toast.error('Please select a branch location');
      return;
    }

    const validLines = lines.filter((l) => l.productId && parseFloat(l.quantity) > 0);
    if (validLines.length === 0) {
      toast.error('Please add at least one valid line item');
      return;
    }

    startTransition(async () => {
      try {
        const payload = {
          customerId,
          locationId,
          issueDate,
          dueDate,
          notes: notes || undefined,
          terms: terms || undefined,
          lines: validLines.map((l) => {
            const p = prodMap.get(l.productId);
            return {
              productId: l.productId,
              quantity: l.quantity,
              unitPriceMinor: Math.round((parseFloat(l.unitPriceMwk) || 0) * 100),
              discountMinor: Math.round((parseFloat(l.discountMwk) || 0) * 100),
              taxRateId: p?.taxRateId || defaultTaxRateId,
            };
          }),
        };

        const res = await createDirectInvoiceAction(payload);
        toast.success('Direct invoice draft created successfully');
        router.push(`/sales/invoices/${res.invoice.id}`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to create invoice');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 gap-1">
            <Link href="/sales/invoices">
              <ArrowLeft className="h-4 w-4" /> Back to Invoices
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ace-navy">Create Direct Invoice</h1>
            <p className="text-xs text-muted-foreground">
              Draft a direct sales invoice. Once created, you can review and issue it.
            </p>
          </div>
        </div>

        <Button
          type="submit"
          disabled={isPending}
          className="bg-ace-gold text-ace-navy hover:bg-ace-gold/90 font-bold shadow-sm"
        >
          {isPending ? 'Creating Draft...' : 'Create Draft Invoice'}
        </Button>
      </div>

      {/* Header Fields Card */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-ace-navy">Invoice Information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          {/* Customer */}
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-semibold">
              Customer <span className="text-rose-500">*</span>
            </Label>
            <Select value={customerId} onValueChange={handleCustomerSelect}>
              <SelectTrigger className="bg-card">
                <SelectValue placeholder="Select corporate or walk-in customer..." />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.accountNumber}) {c.isWalkIn ? '— [Walk-in]' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedCustomer && !selectedCustomer.isWalkIn && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Credit Limit: MWK {(selectedCustomer.creditLimitMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })} • Payment Terms: {selectedCustomer.paymentTermsDays} days
              </p>
            )}
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              Branch / Location <span className="text-rose-500">*</span>
            </Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger className="bg-card">
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Issue Date */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Issue Date</Label>
            <Input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="bg-card"
            />
          </div>

          {/* Due Date */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Due Date</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="bg-card"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-semibold">Invoice Notes (Optional)</Label>
            <Input
              placeholder="e.g. Purchase order PO-2026-0941 reference"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-card"
            />
          </div>

          {/* Terms */}
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-semibold">Payment Terms</Label>
            <Input
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              className="bg-card"
            />
          </div>
        </CardContent>
      </Card>

      {/* Lines Card */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3 bg-muted/20">
          <CardTitle className="text-sm font-bold text-ace-navy">Line Items</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addLine}
            className="h-8 gap-1 text-xs"
          >
            <Plus className="h-3.5 w-3.5" /> Add Line
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/10">
              <TableRow>
                <TableHead className="w-[38%]">Product / SKU</TableHead>
                <TableHead className="w-[14%] text-right">Quantity</TableHead>
                <TableHead className="w-[18%] text-right">Unit Price (MWK)</TableHead>
                <TableHead className="w-[14%] text-right">Discount (MWK)</TableHead>
                <TableHead className="w-[12%] text-right">Total (MWK)</TableHead>
                <TableHead className="w-10 text-center"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, idx) => {
                const prod = prodMap.get(line.productId);
                const qNum = parseFloat(line.quantity) || 0;
                const pNum = parseFloat(line.unitPriceMwk) || 0;
                const dNum = parseFloat(line.discountMwk) || 0;
                const lineGross = qNum * pNum;
                const lineNet = Math.max(0, lineGross - dNum);
                const taxBps = prod?.taxBasisPoints ?? 1750;
                const lineTax = (lineNet * taxBps) / 10000;
                const lineTotal = lineNet + lineTax;

                return (
                  <TableRow key={idx}>
                    <TableCell>
                      <Select
                        value={line.productId}
                        onValueChange={(val) => handleProductChange(idx, val)}
                      >
                        <SelectTrigger className="bg-card text-xs">
                          <SelectValue placeholder="Select product..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id} className="text-xs">
                              {p.name} ({p.sku}) — MWK {(p.sellingPriceMinor / 100).toFixed(2)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {prod && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          SKU: {prod.sku} • Avg Cost: MWK {(prod.avgCostMinor / 100).toFixed(2)}
                        </p>
                      )}
                    </TableCell>

                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min="0.001"
                        value={line.quantity}
                        onChange={(e) => handleLineChange(idx, 'quantity', e.target.value)}
                        className="text-right font-mono text-xs bg-card"
                      />
                    </TableCell>

                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.unitPriceMwk}
                        onChange={(e) => handleLineChange(idx, 'unitPriceMwk', e.target.value)}
                        className="text-right font-mono text-xs bg-card"
                      />
                    </TableCell>

                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.discountMwk}
                        onChange={(e) => handleLineChange(idx, 'discountMwk', e.target.value)}
                        className="text-right font-mono text-xs bg-card"
                      />
                    </TableCell>

                    <TableCell className="text-right font-mono text-xs font-semibold text-foreground">
                      {lineTotal.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>

                    <TableCell className="text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={lines.length === 1}
                        onClick={() => removeLine(idx)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* Document Summary Card at Bottom */}
          <div className="flex justify-end p-4 bg-muted/10 border-t">
            <div className="w-80 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="font-mono">
                  MWK {(totals.subtotalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                </span>
              </div>
              {totals.discountMinor > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Total Discount:</span>
                  <span className="font-mono">
                    - MWK {(totals.discountMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax (VAT 16.5% / Exempt):</span>
                <span className="font-mono">
                  MWK {(totals.taxMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="border-t pt-1.5 flex justify-between text-base font-bold text-ace-navy">
                <span>Grand Total:</span>
                <span className="font-mono">
                  MWK {(totals.totalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
