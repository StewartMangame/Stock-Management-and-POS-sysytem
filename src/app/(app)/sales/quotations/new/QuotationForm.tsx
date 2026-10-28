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
import { Trash2, Plus, ArrowLeft, Calculator } from 'lucide-react';
import { createQuotationAction } from '../actions';
import { calculateSalesLine, calculateDocumentTotals } from '@/lib/sales-math';

interface CustomerOption {
  id: string;
  name: string;
  accountNumber: string;
  isWalkIn: boolean;
  creditLimitMinor: number;
}

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  sellingPriceMinor: number;
  taxRateId?: string | null;
  taxBasisPoints?: number;
}

interface LocationOption {
  id: string;
  name: string;
}

interface QuotationFormProps {
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

export function QuotationForm({
  customers,
  products,
  locations,
  defaultTaxRateId,
}: QuotationFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [customerId, setCustomerId] = useState('');
  const [locationId, setLocationId] = useState(locations[0]?.id || '');
  const [quotationDate, setQuotationDate] = useState(new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('Payment within 30 days of invoice date. Prices valid for 30 days.');

  const [lines, setLines] = useState<FormLine[]>([
    { productId: '', quantity: '1', unitPriceMwk: '', discountMwk: '0' },
  ]);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  // Helper map for fast product lookup
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

  // Calculate live preview totals
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
          quotationDate,
          validUntil,
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

        const res = await createQuotationAction(payload);
        toast.success('Quotation draft created successfully');
        router.push(`/sales/quotations/${res.quotation.id}`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to create quotation');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 gap-1">
            <Link href="/sales/quotations">
              <ArrowLeft className="h-4 w-4" /> Back to Quotations
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ace-navy">New Quotation</h1>
            <p className="text-xs text-muted-foreground">
              Create a proforma quotation with live tax calculation and component tracking.
            </p>
          </div>
        </div>

        <Button
          type="submit"
          disabled={isPending}
          className="bg-ace-gold text-ace-navy hover:bg-ace-gold/90 font-semibold shadow-sm"
        >
          {isPending ? 'Saving Quotation...' : 'Create Quotation'}
        </Button>
      </div>

      {/* Header Fields Card */}
      <Card className="shadow-sm">
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <Label htmlFor="customer">Customer *</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger id="customer">
                <SelectValue placeholder="Select a customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.accountNumber})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCustomer && (
              <p className="text-[11px] text-muted-foreground font-mono">
                {selectedCustomer.isWalkIn
                  ? 'Walk-in cash customer'
                  : `Credit Limit: MWK ${(selectedCustomer.creditLimitMinor / 100).toLocaleString('en-MW', {
                      minimumFractionDigits: 2,
                    })}`}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="location">Branch / Location *</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger id="location">
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

          <div className="space-y-1">
            <Label htmlFor="quoteDate">Quotation Date</Label>
            <Input
              id="quoteDate"
              type="date"
              value={quotationDate}
              onChange={(e) => setQuotationDate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="validUntil">Valid Until</Label>
            <Input
              id="validUntil"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Line Items Table */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 border-b py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold text-ace-navy">Quotation Lines</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={addLine} className="h-8 gap-1">
            <Plus className="h-3.5 w-3.5" /> Add Line
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow>
                <TableHead className="w-[38%]">Product / Description</TableHead>
                <TableHead className="w-[12%] text-right">Quantity</TableHead>
                <TableHead className="w-[18%] text-right">Unit Price (MWK)</TableHead>
                <TableHead className="w-[14%] text-right">Discount (MWK)</TableHead>
                <TableHead className="w-[14%] text-right">Line Total</TableHead>
                <TableHead className="w-[4%]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, idx) => {
                const prod = prodMap.get(line.productId);
                const qNum = parseFloat(line.quantity) || 0;
                const pNum = parseFloat(line.unitPriceMwk) || 0;
                const dNum = parseFloat(line.discountMwk) || 0;
                const lineCalc = calculateSalesLine({
                  quantity: qNum,
                  unitPriceMinor: Math.round(pNum * 100),
                  discountMinor: Math.round(dNum * 100),
                  taxRateBasisPoints: prod?.taxBasisPoints ?? 1750,
                });

                return (
                  <TableRow key={idx}>
                    <TableCell>
                      <Select
                        value={line.productId}
                        onValueChange={(val) => handleProductChange(idx, val)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select product..." />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id} className="text-xs">
                              <span className="font-semibold text-ace-navy mr-2">{p.sku}</span>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min="0.001"
                        value={line.quantity}
                        onChange={(e) => handleLineChange(idx, 'quantity', e.target.value)}
                        className="h-8 text-right font-mono text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={line.unitPriceMwk}
                        onChange={(e) => handleLineChange(idx, 'unitPriceMwk', e.target.value)}
                        className="h-8 text-right font-mono text-xs"
                        placeholder="0.00"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={line.discountMwk}
                        onChange={(e) => handleLineChange(idx, 'discountMwk', e.target.value)}
                        className="h-8 text-right font-mono text-xs"
                        placeholder="0.00"
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium text-xs">
                      MWK {(lineCalc.lineTotalMinor / 100).toLocaleString('en-MW', {
                        minimumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLine(idx)}
                        disabled={lines.length === 1}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Notes & Live Totals Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="notes">Client Notes</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Price includes delivery to Lilongwe depot"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="terms">Terms & Conditions</Label>
            <Input
              id="terms"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="e.g. Valid for 30 days from date of issue"
            />
          </div>
        </div>

        {/* Live Financial Totals Summary */}
        <Card className="shadow-sm bg-muted/20">
          <CardHeader className="py-3 border-b">
            <CardTitle className="text-sm font-semibold text-ace-navy flex items-center gap-1.5">
              <Calculator className="h-4 w-4" /> Live Financial Calculation
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-2.5 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal:</span>
              <span className="font-mono">
                MWK {(totals.subtotalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
              </span>
            </div>
            {totals.discountMinor > 0 && (
              <div className="flex justify-between text-amber-600">
                <span>Total Discount:</span>
                <span className="font-mono">
                  - MWK {(totals.discountMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>VAT (17.5% Standard):</span>
              <span className="font-mono">
                MWK {(totals.taxMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="border-t pt-2 flex justify-between font-bold text-base text-ace-navy">
              <span>Grand Total:</span>
              <span className="font-mono">
                MWK {(totals.totalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
