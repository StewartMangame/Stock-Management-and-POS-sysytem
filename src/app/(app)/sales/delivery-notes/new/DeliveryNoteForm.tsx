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
import { ArrowLeft, Truck, Package, ShieldCheck, Check } from 'lucide-react';
import { createDeliveryNoteAction } from '../actions';

export interface InvoiceOption {
  id: string;
  documentNumber: string | null;
  customerName: string;
  customerAccount: string;
  locationName: string;
  locationId: string;
  issueDate: string;
  lines: Array<{
    id: string;
    productId: string;
    productName: string;
    sku: string;
    quantity: string;
    deliveredQty: string;
    isSerialized: boolean;
    productType: string;
    availableSerials: string[];
    bundleComponents?: Array<{
      componentProductId: string;
      componentProductName: string;
      quantityPerBundle: string;
      isSerialized: boolean;
      availableSerials: string[];
    }>;
  }>;
}

interface DeliveryNoteFormProps {
  invoices: InvoiceOption[];
  preselectedInvoiceId?: string;
}

export function DeliveryNoteForm({ invoices, preselectedInvoiceId }: DeliveryNoteFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selectedInvoiceId, setSelectedInvoiceId] = useState(
    preselectedInvoiceId && invoices.some((i) => i.id === preselectedInvoiceId)
      ? preselectedInvoiceId
      : invoices[0]?.id || '',
  );

  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));
  const [receivedByCustomer, setReceivedByCustomer] = useState('');
  const [notes, setNotes] = useState('');

  const currentInvoice = invoices.find((inv) => inv.id === selectedInvoiceId);

  // Line dispatch states: lineId -> dispatch quantity
  const [dispatchQuantities, setDispatchQuantities] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (currentInvoice) {
      for (const line of currentInvoice.lines) {
        const remaining = Math.max(0, parseFloat(line.quantity) - parseFloat(line.deliveredQty));
        init[line.id] = remaining.toString();
      }
    }
    return init;
  });

  // Selected serial numbers: lineId -> array of serial strings
  const [selectedSerials, setSelectedSerials] = useState<Record<string, string[]>>({});

  // Selected bundle component serials: lineId -> Record<componentProductId, string[]>
  const [selectedBundleSerials, setSelectedBundleSerials] = useState<
    Record<string, Record<string, string[]>>
  >({});

  function handleInvoiceChange(invId: string) {
    setSelectedInvoiceId(invId);
    const inv = invoices.find((i) => i.id === invId);
    if (inv) {
      const initQty: Record<string, string> = {};
      for (const line of inv.lines) {
        const remaining = Math.max(0, parseFloat(line.quantity) - parseFloat(line.deliveredQty));
        initQty[line.id] = remaining.toString();
      }
      setDispatchQuantities(initQty);
      setSelectedSerials({});
      setSelectedBundleSerials({});
    }
  }

  function handleQuantityChange(lineId: string, val: string) {
    setDispatchQuantities((prev) => ({ ...prev, [lineId]: val }));
  }

  function toggleSerial(lineId: string, serial: string) {
    setSelectedSerials((prev) => {
      const current = prev[lineId] || [];
      if (current.includes(serial)) {
        return { ...prev, [lineId]: current.filter((s) => s !== serial) };
      } else {
        return { ...prev, [lineId]: [...current, serial] };
      }
    });
  }

  function toggleBundleComponentSerial(lineId: string, compId: string, serial: string) {
    setSelectedBundleSerials((prev) => {
      const lineMap = prev[lineId] || {};
      const currentList = lineMap[compId] || [];
      const updatedList = currentList.includes(serial)
        ? currentList.filter((s) => s !== serial)
        : [...currentList, serial];

      return {
        ...prev,
        [lineId]: {
          ...lineMap,
          [compId]: updatedList,
        },
      };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedInvoiceId) {
      toast.error('Please select an invoice');
      return;
    }

    if (!currentInvoice) return;

    // Build lines to dispatch
    const linesToDispatch: Array<{
      salesDocumentLineId: string;
      quantity: number;
      serialNumbers?: string[];
      bundleComponentSerials?: Record<string, string[]>;
    }> = [];

    for (const line of currentInvoice.lines) {
      const qty = parseFloat(dispatchQuantities[line.id] || '0');
      if (qty <= 0) continue;

      const remaining = Math.max(0, parseFloat(line.quantity) - parseFloat(line.deliveredQty));
      if (qty > remaining) {
        toast.error(`Quantity for ${line.productName} exceeds remaining undelivered amount (${remaining})`);
        return;
      }

      // Check serial numbers if serialized
      if (line.isSerialized) {
        const serials = selectedSerials[line.id] || [];
        if (serials.length !== qty) {
          toast.error(
            `Line ${line.productName} requires exactly ${qty} serial number(s) (currently selected: ${serials.length})`,
          );
          return;
        }
      }

      // Check bundle component serials
      const bundleSerialsMap = selectedBundleSerials[line.id];
      if (line.bundleComponents && line.bundleComponents.length > 0) {
        for (const comp of line.bundleComponents) {
          if (comp.isSerialized) {
            const required = Math.round(qty * parseFloat(comp.quantityPerBundle));
            const selected = bundleSerialsMap?.[comp.componentProductId] || [];
            if (selected.length !== required) {
              toast.error(
                `Bundle component '${comp.componentProductName}' requires ${required} serial(s) (currently selected: ${selected.length})`,
              );
              return;
            }
          }
        }
      }

      linesToDispatch.push({
        salesDocumentLineId: line.id,
        quantity: qty,
        serialNumbers: line.isSerialized ? selectedSerials[line.id] : undefined,
        bundleComponentSerials:
          line.bundleComponents && line.bundleComponents.length > 0
            ? selectedBundleSerials[line.id]
            : undefined,
      });
    }

    if (linesToDispatch.length === 0) {
      toast.error('Please enter a dispatch quantity greater than 0 for at least one line');
      return;
    }

    startTransition(async () => {
      try {
        const payload = {
          salesDocumentId: selectedInvoiceId,
          deliveryDate,
          receivedByCustomer: receivedByCustomer || undefined,
          notes: notes || undefined,
          lines: linesToDispatch,
        };

        const res = await createDeliveryNoteAction(payload);
        toast.success(`Delivery note ${res.deliveryNote.deliveryNumber} dispatched successfully!`);
        router.push(`/sales/delivery-notes/${res.deliveryNote.id}`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to dispatch delivery note');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 gap-1">
            <Link href="/sales/delivery-notes">
              <ArrowLeft className="h-4 w-4" /> Back to Delivery Notes
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ace-navy">Dispatch Delivery Note</h1>
            <p className="text-xs text-muted-foreground">
              Select an issued invoice, enter quantities to dispatch, and capture required serial numbers.
            </p>
          </div>
        </div>

        <Button
          type="submit"
          disabled={isPending || !currentInvoice}
          className="bg-ace-gold text-ace-navy hover:bg-ace-gold/90 font-bold shadow-sm"
        >
          {isPending ? 'Dispatching...' : 'Dispatch Goods'}
        </Button>
      </div>

      {/* Select Invoice Card */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-ace-navy">Invoice & Dispatch Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-semibold">
              Select Issued Invoice <span className="text-rose-500">*</span>
            </Label>
            <Select value={selectedInvoiceId} onValueChange={handleInvoiceChange}>
              <SelectTrigger className="bg-card">
                <SelectValue placeholder="Select invoice with pending delivery..." />
              </SelectTrigger>
              <SelectContent>
                {invoices.map((inv) => (
                  <SelectItem key={inv.id} value={inv.id}>
                    {inv.documentNumber || 'Draft'} — {inv.customerName} ({inv.locationName})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Delivery Date</Label>
            <Input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="bg-card"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Received by (Customer / Rep)</Label>
            <Input
              placeholder="e.g. John Phiri"
              value={receivedByCustomer}
              onChange={(e) => setReceivedByCustomer(e.target.value)}
              className="bg-card"
            />
          </div>

          <div className="space-y-1.5 md:col-span-4">
            <Label className="text-xs font-semibold">Delivery Dispatch Notes</Label>
            <Input
              placeholder="e.g. Dispatched via company delivery vehicle MZ-9412"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-card"
            />
          </div>
        </CardContent>
      </Card>

      {/* Deliverable Lines Card */}
      {currentInvoice && (
        <Card className="shadow-sm">
          <CardHeader className="pb-3 bg-muted/20">
            <CardTitle className="text-sm font-bold text-ace-navy">
              Deliverable Items for Invoice {currentInvoice.documentNumber}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/10">
                <TableRow>
                  <TableHead className="w-[30%]">Product / SKU</TableHead>
                  <TableHead className="w-[12%] text-right">Invoiced</TableHead>
                  <TableHead className="w-[12%] text-right">Delivered</TableHead>
                  <TableHead className="w-[12%] text-right font-semibold">Remaining</TableHead>
                  <TableHead className="w-[16%] text-right font-bold text-ace-navy">Dispatch Qty</TableHead>
                  <TableHead className="w-[18%]">Serial Tracking</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentInvoice.lines.map((line) => {
                  const invQty = parseFloat(line.quantity);
                  const delQty = parseFloat(line.deliveredQty);
                  const remaining = Math.max(0, invQty - delQty);
                  const curDispatch = parseFloat(dispatchQuantities[line.id] || '0');

                  return (
                    <TableRow key={line.id}>
                      <TableCell>
                        <div className="font-semibold text-foreground">{line.productName}</div>
                        <div className="text-xs font-mono text-muted-foreground">SKU: {line.sku}</div>
                      </TableCell>

                      <TableCell className="text-right font-mono text-xs">
                        {invQty.toLocaleString()}
                      </TableCell>

                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {delQty.toLocaleString()}
                      </TableCell>

                      <TableCell className="text-right font-mono text-xs font-semibold text-emerald-700">
                        {remaining.toLocaleString()}
                      </TableCell>

                      <TableCell>
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          max={remaining}
                          disabled={remaining <= 0}
                          value={dispatchQuantities[line.id] || '0'}
                          onChange={(e) => handleQuantityChange(line.id, e.target.value)}
                          className="text-right font-mono font-semibold text-xs bg-card"
                        />
                      </TableCell>

                      <TableCell>
                        {line.isSerialized && curDispatch > 0 && (
                          <div className="space-y-1">
                            <span className="text-[11px] font-semibold text-foreground">
                              Select {curDispatch} serial(s):
                            </span>
                            <div className="max-h-28 overflow-y-auto rounded border p-1.5 bg-muted/20 space-y-1">
                              {line.availableSerials.length === 0 ? (
                                <p className="text-[10px] text-rose-600">No serials in stock!</p>
                              ) : (
                                line.availableSerials.map((s) => {
                                  const isChecked = (selectedSerials[line.id] || []).includes(s);
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

                        {line.bundleComponents && line.bundleComponents.some((c) => c.isSerialized) && curDispatch > 0 && (
                          <div className="space-y-2 mt-1">
                            {line.bundleComponents
                              .filter((c) => c.isSerialized)
                              .map((comp) => {
                                const required = Math.round(curDispatch * parseFloat(comp.quantityPerBundle));
                                const currentList =
                                  selectedBundleSerials[line.id]?.[comp.componentProductId] || [];

                                return (
                                  <div key={comp.componentProductId} className="space-y-1">
                                    <span className="text-[11px] font-semibold text-foreground">
                                      {comp.componentProductName}: select {required} serial(s)
                                    </span>
                                    <div className="max-h-24 overflow-y-auto rounded border p-1.5 bg-muted/20 space-y-1">
                                      {comp.availableSerials.length === 0 ? (
                                        <p className="text-[10px] text-rose-600">No serials in stock!</p>
                                      ) : (
                                        comp.availableSerials.map((s) => {
                                          const isChecked = currentList.includes(s);
                                          return (
                                            <label
                                              key={s}
                                              className="flex items-center gap-1.5 text-xs font-mono cursor-pointer hover:bg-muted/40 p-0.5 rounded"
                                            >
                                              <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={() =>
                                                  toggleBundleComponentSerial(
                                                    line.id,
                                                    comp.componentProductId,
                                                    s,
                                                  )
                                                }
                                                className="rounded border-gray-300 text-ace-navy"
                                              />
                                              {s}
                                            </label>
                                          );
                                        })
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        )}

                        {!line.isSerialized && (!line.bundleComponents || !line.bundleComponents.some((c) => c.isSerialized)) && (
                          <span className="text-xs text-muted-foreground">Standard item</span>
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
