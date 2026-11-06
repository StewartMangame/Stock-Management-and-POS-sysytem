'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
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
import { createGoodsReceiptAction, validateGoodsReceiptAction } from './actions';
import { formatMwk } from '@/lib/money';
import { Plus, Trash2, ArrowLeft, AlertTriangle, ShieldCheck, DollarSign } from 'lucide-react';
import Link from 'next/link';
import { allocateLandedCostsLargestRemainder, convertSupplierToMwkMinor, roundHalfUp, toDecimalQty } from '@/lib/stock-math';
import Decimal from 'decimal.js';

interface Supplier {
  id: string;
  name: string;
  code: string;
  defaultCurrency: string | null;
}

interface Location {
  id: string;
  name: string;
  type: string;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  serialTracking: boolean;
  lastCostMinor: number;
}

interface POItem {
  id: string;
  productId: string;
  orderedQty: string;
  receivedQty: string;
  unitCostSupplier: string;
}

interface POData {
  id: string;
  poNumber: string;
  supplierId: string;
  locationId: string;
  currency: string;
  exchangeRate: string;
  items: POItem[];
}

interface ReceiptLine {
  poItemId?: string | null;
  productId: string;
  receivedQty: string;
  unitCostSupplier: string;
  serialNumbersText: string;
}

interface LandedCostRow {
  costType: 'freight' | 'duty' | 'clearing' | 'other';
  amount: string;
  currency: string;
  exchangeRate: string;
}

interface Props {
  suppliers: Supplier[];
  locations: Location[];
  products: Product[];
  purchaseOrders: Array<{ id: string; poNumber: string; supplierId: string }>;
  initialPO?: POData | null;
}

export function ReceiptForm({
  suppliers,
  locations,
  products,
  purchaseOrders,
  initialPO,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [poId, setPoId] = useState(initialPO?.id ?? '');
  const [supplierId, setSupplierId] = useState(initialPO?.supplierId ?? '');
  const [locationId, setLocationId] = useState(initialPO?.locationId ?? locations[0]?.id ?? '');
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().split('T')[0]!);
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [currency, setCurrency] = useState(initialPO?.currency ?? 'MWK');
  const [exchangeRate, setExchangeRate] = useState(
    initialPO ? Number(initialPO.exchangeRate).toString() : '1'
  );
  const [notes, setNotes] = useState('');

  // Items
  const [items, setItems] = useState<ReceiptLine[]>(() => {
    if (initialPO?.items && initialPO.items.length > 0) {
      return initialPO.items.map((pi) => {
        const remaining = Math.max(0, Number(pi.orderedQty) - Number(pi.receivedQty));
        return {
          poItemId: pi.id,
          productId: pi.productId,
          receivedQty: remaining > 0 ? remaining.toString() : '0',
          unitCostSupplier: Number(pi.unitCostSupplier).toString(),
          serialNumbersText: '',
        };
      });
    }
    return [
      {
        poItemId: null,
        productId: '',
        receivedQty: '1',
        unitCostSupplier: '0',
        serialNumbersText: '',
      },
    ];
  });

  // Landed Costs
  const [landedCosts, setLandedCosts] = useState<LandedCostRow[]>([]);
  const [allowOverReceipt, setAllowOverReceipt] = useState(false);
  const [overReceiptWarning, setOverReceiptWarning] = useState<string | null>(null);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const handleSupplierChange = (id: string) => {
    setSupplierId(id);
    const supp = suppliers.find((s) => s.id === id);
    if (supp?.defaultCurrency) {
      setCurrency(supp.defaultCurrency);
      if (supp.defaultCurrency === 'MWK') {
        setExchangeRate('1');
      } else if (supp.defaultCurrency === 'USD' && exchangeRate === '1') {
        setExchangeRate('1750');
      }
    }
  };

  const handleAddLine = () => {
    setItems((prev) => [
      ...prev,
      {
        poItemId: null,
        productId: '',
        receivedQty: '1',
        unitCostSupplier: '0',
        serialNumbersText: '',
      },
    ]);
  };

  const handleRemoveLine = (idx: number) => {
    if (items.length <= 1) {
      toast.error('Receipt must have at least one line.');
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleItemChange = (idx: number, field: keyof ReceiptLine, value: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, [field]: value };
      return next;
    });
  };

  const handleAddLandedCost = () => {
    setLandedCosts((prev) => [
      ...prev,
      {
        costType: 'freight',
        amount: '0',
        currency: 'MWK',
        exchangeRate: '1',
      },
    ]);
  };

  const handleRemoveLandedCost = (idx: number) => {
    setLandedCosts((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleLandedCostChange = (
    idx: number,
    field: keyof LandedCostRow,
    value: string
  ) => {
    setLandedCosts((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, [field]: value };
      return next;
    });
  };

  // ── Largest Remainder Landed Cost Preview Calculation ──────────────────────
  const rateNum = Number(exchangeRate) || 1;

  // Calculate items line values in MWK tambala
  const itemValues = items.map((it) => {
    const qty = Number(it.receivedQty) || 0;
    const unitCost = Number(it.unitCostSupplier) || 0;
    const lineSupplier = qty * unitCost;
    const lineMwkMinor = Math.round(lineSupplier * rateNum * 100);
    return { qty, unitCost, lineSupplier, lineMwkMinor };
  });

  const totalItemsMwkMinor = itemValues.reduce((sum, it) => sum + it.lineMwkMinor, 0);

  // Calculate total landed cost in MWK tambala
  const totalLandedMwkMinor = landedCosts.reduce((sum, lc) => {
    const amt = Number(lc.amount) || 0;
    const rate = Number(lc.exchangeRate) || 1;
    return sum + Math.round(amt * rate * 100);
  }, 0);

  // Allocate landed cost share per item
  const landedShares = useMemo(() => {
    if (totalLandedMwkMinor <= 0 || totalItemsMwkMinor <= 0) {
      return items.map(() => 0);
    }
    const lineValues = itemValues.map((it) => it.lineMwkMinor);
    return allocateLandedCostsLargestRemainder(lineValues, totalLandedMwkMinor);
  }, [itemValues, totalLandedMwkMinor, totalItemsMwkMinor, items]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!supplierId) {
      toast.error('Please select a supplier.');
      return;
    }
    if (!locationId) {
      toast.error('Please select a destination location.');
      return;
    }
    if (items.some((it) => !it.productId || Number(it.receivedQty) <= 0)) {
      toast.error('Please select a product and positive quantity for all items.');
      return;
    }

    // Validate serial numbers for tracked items
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const prod = productMap.get(it.productId);
      if (prod?.serialTracking) {
        const serials = it.serialNumbersText
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const expectedQty = Math.round(Number(it.receivedQty));
        if (serials.length !== expectedQty) {
          toast.error(
            `Line ${i + 1} (${prod.name}) is serial tracked: entered ${
              serials.length
            } serials, but received quantity is ${expectedQty}. Exactly 1 serial per unit is required.`
          );
          return;
        }
      }
    }

    const payload = {
      purchaseOrderId: poId || null,
      supplierId,
      locationId,
      receivedDate,
      supplierInvoiceNumber: supplierInvoiceNumber.trim() || null,
      currency,
      exchangeRate: Number(exchangeRate) || 1,
      notes: notes.trim() || null,
      allowOverReceipt,
      items: items.map((it) => {
        const prod = productMap.get(it.productId);
        const serials = prod?.serialTracking
          ? it.serialNumbersText
              .split(/[\n,]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
        return {
          poItemId: it.poItemId || null,
          productId: it.productId,
          receivedQty: it.receivedQty,
          unitCostSupplier: it.unitCostSupplier,
          serialNumbers: serials,
        };
      }),
      landedCosts: landedCosts
        .filter((lc) => Number(lc.amount) > 0)
        .map((lc) => ({
          costType: lc.costType,
          amount: lc.amount,
          currency: lc.currency,
          exchangeRate: Number(lc.exchangeRate) || 1,
        })),
    };

    // If PO linked, check for over-receipt warnings before saving
    if (poId && !allowOverReceipt) {
      try {
        const validation = await validateGoodsReceiptAction(payload);
        if (validation.hasOverReceipt) {
          setOverReceiptWarning(validation.warnings.join(' '));
          toast.warning('Over-receipt detected! Please review and check the confirmation box.');
          return;
        }
      } catch (err: any) {
        toast.error(err.message || 'Validation error');
        return;
      }
    }

    startTransition(async () => {
      try {
        const res = await createGoodsReceiptAction(payload);
        if (res.success && res.grn) {
          toast.success(`Goods Receipt ${res.grn.grnNumber} processed successfully!`);
          router.push(`/purchasing/receipts/${res.grn.id}`);
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to process goods receipt.');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/purchasing/receipts">
            <Button variant="ghost" size="icon" type="button">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-ace-navy">Receive Goods (GRN)</h1>
            <p className="text-sm text-ace-muted">
              Record physical inventory intake, serial numbers, and distribute landed costs.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/purchasing/receipts">
            <Button variant="outline" type="button">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={isPending} id="save-grn-btn">
            {isPending ? 'Processing GRN...' : 'Complete Goods Receipt'}
          </Button>
        </div>
      </div>

      {/* Over-receipt banner if triggered */}
      {overReceiptWarning && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <span className="font-semibold block">Warning: Over-Receipt Detected</span>
            <p>{overReceiptWarning}</p>
            <label className="flex items-center gap-2 cursor-pointer font-medium text-amber-950">
              <input
                type="checkbox"
                checked={allowOverReceipt}
                onChange={(e) => setAllowOverReceipt(e.target.checked)}
                className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
              />
              I authorise accepting quantities higher than originally ordered.
            </label>
          </div>
        </div>
      )}

      {/* Header Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 rounded-lg border bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <Label htmlFor="supplierId">Supplier *</Label>
          <Select value={supplierId} onValueChange={handleSupplierChange}>
            <SelectTrigger id="supplierId">
              <SelectValue placeholder="Select supplier..." />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="locationId">Receiving Location *</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger id="locationId">
              <SelectValue placeholder="Select location..." />
            </SelectTrigger>
            <SelectContent>
              {locations.map((loc) => (
                <SelectItem key={loc.id} value={loc.id}>
                  {loc.name} ({loc.type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="poId">Linked Purchase Order (Optional)</Label>
          <Select value={poId} onValueChange={setPoId}>
            <SelectTrigger id="poId">
              <SelectValue placeholder="None (Direct Receipt)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">None (Direct Receipt)</SelectItem>
              {purchaseOrders.map((po) => (
                <SelectItem key={po.id} value={po.id}>
                  {po.poNumber}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="receivedDate">Received Date</Label>
            <Input
              id="receivedDate"
              type="date"
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supplierInvoiceNumber">Supplier Invoice #</Label>
            <Input
              id="supplierInvoiceNumber"
              placeholder="INV-99214"
              value={supplierInvoiceNumber}
              onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency">Items Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger id="currency">
              <SelectValue placeholder="Select currency..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MWK">MWK — Malawi Kwacha</SelectItem>
              <SelectItem value="USD">USD — US Dollar</SelectItem>
              <SelectItem value="ZAR">ZAR — South African Rand</SelectItem>
              <SelectItem value="EUR">EUR — Euro</SelectItem>
              <SelectItem value="GBP">GBP — British Pound</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="exchangeRate">Exchange Rate (MWK per 1 {currency})</Label>
          <Input
            id="exchangeRate"
            type="number"
            step="0.000001"
            min="0.000001"
            value={exchangeRate}
            onChange={(e) => setExchangeRate(e.target.value)}
            disabled={currency === 'MWK'}
            required
          />
        </div>

        <div className="space-y-2 md:col-span-3">
          <Label htmlFor="notes">Notes / Delivery Reference</Label>
          <Input
            id="notes"
            placeholder="Delivery note #, carrier name, container #, etc."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {/* Received Items */}
      <div className="rounded-lg border bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ace-navy">Received Items</h2>
            <p className="text-xs text-ace-muted">
              Enter quantities received and capture required serial numbers.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddLine}
            id="add-item-btn"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Item
          </Button>
        </div>

        <div className="space-y-4">
          {items.map((item, idx) => {
            const prod = productMap.get(item.productId);
            const qtyNum = Number(item.receivedQty) || 0;
            const unitCostNum = Number(item.unitCostSupplier) || 0;
            const lineSupplier = qtyNum * unitCostNum;
            const lineMwkMinor = itemValues[idx]?.lineMwkMinor ?? 0;
            const landedShareMinor = landedShares[idx] ?? 0;
            const totalLineMwkMinor = lineMwkMinor + landedShareMinor;
            const effectiveUnitCostMinor =
              qtyNum > 0 ? Math.round(totalLineMwkMinor / qtyNum) : 0;

            const enteredSerials = prod?.serialTracking
              ? item.serialNumbersText
                  .split(/[\n,]+/)
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [];

            return (
              <div
                key={idx}
                className="rounded-lg border bg-gray-50/50 p-4 space-y-3"
              >
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-4 space-y-1">
                    <Label className="text-xs">Product *</Label>
                    <Select
                      value={item.productId}
                      onValueChange={(val) => handleItemChange(idx, 'productId', val)}
                    >
                      <SelectTrigger className="w-full bg-white">
                        <SelectValue placeholder="Select product..." />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                            {p.serialTracking ? ' [Serial Tracked]' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-xs">Received Qty *</Label>
                    <Input
                      type="number"
                      step="0.001"
                      min="0.001"
                      value={item.receivedQty}
                      onChange={(e) => handleItemChange(idx, 'receivedQty', e.target.value)}
                      className="bg-white"
                      required
                    />
                  </div>

                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-xs">Unit Cost ({currency})</Label>
                    <Input
                      type="number"
                      step="0.0001"
                      min="0"
                      value={item.unitCostSupplier}
                      onChange={(e) =>
                        handleItemChange(idx, 'unitCostSupplier', e.target.value)
                      }
                      className="bg-white"
                      required
                    />
                  </div>

                  <div className="md:col-span-3 text-right bg-blue-50/70 p-2.5 rounded-lg border border-blue-200 shadow-sm">
                    <div className="text-[10px] font-bold text-blue-900 uppercase tracking-wider">
                      Converted MWK Subtotal
                    </div>
                    <div className="font-mono text-base font-bold text-ace-navy">
                      {formatMwk(totalLineMwkMinor)}
                    </div>
                    <div className="text-xs text-ace-blue font-mono font-semibold">
                      Unit Cost: {formatMwk(effectiveUnitCostMinor)}
                    </div>
                    {currency !== 'MWK' && (
                      <div className="text-[10px] text-gray-600 font-mono mt-0.5">
                        Supplier: {currency} {lineSupplier.toFixed(2)} ({currency} {unitCostNum.toFixed(2)}/unit)
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-1 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveLine(idx)}
                      disabled={items.length <= 1}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Serial number capture box if serial-tracked */}
                {prod?.serialTracking && (
                  <div className="mt-2 pt-2 border-t border-gray-200">
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs font-semibold text-purple-900 flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 text-purple-600" />
                        Serial Numbers (1 per unit, separated by commas or newlines):
                      </Label>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          enteredSerials.length === Math.round(qtyNum)
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {enteredSerials.length} / {Math.round(qtyNum)} entered
                      </span>
                    </div>
                    <textarea
                      rows={2}
                      className="w-full text-xs font-mono rounded-md border border-gray-300 p-2 focus:ring-1 focus:ring-ace-blue focus:outline-none bg-white"
                      placeholder="e.g. SN-8921-A, SN-8922-A, SN-8923-A"
                      value={item.serialNumbersText}
                      onChange={(e) =>
                        handleItemChange(idx, 'serialNumbersText', e.target.value)
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Landed Costs Table */}
      <div className="rounded-lg border bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ace-navy flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-purple-600" />
              Landed Costs Breakdown
            </h2>
            <p className="text-xs text-ace-muted">
              Add Freight, Duty, and Clearing charges. Distributed across items using the Largest Remainder Method.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddLandedCost}
            id="add-landed-cost-btn"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Landed Cost
          </Button>
        </div>

        {landedCosts.length === 0 ? (
          <p className="text-sm text-gray-500 py-3 text-center border rounded-md border-dashed">
            No landed costs added. Goods will be valued at supplier invoice cost only.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-xs font-semibold text-gray-600">
                  <th className="py-2.5 px-3">Cost Type</th>
                  <th className="py-2.5 px-3 w-40">Amount</th>
                  <th className="py-2.5 px-3 w-32">Currency</th>
                  <th className="py-2.5 px-3 w-40">Exchange Rate</th>
                  <th className="py-2.5 px-3 w-44 text-right">MWK Tambala</th>
                  <th className="py-2.5 px-3 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {landedCosts.map((lc, idx) => {
                  const amt = Number(lc.amount) || 0;
                  const rate = Number(lc.exchangeRate) || 1;
                  const mwkMinor = Math.round(amt * rate * 100);

                  return (
                    <tr key={idx} className="hover:bg-gray-50/50">
                      <td className="py-2 px-3">
                        <Select
                          value={lc.costType}
                          onValueChange={(val: any) =>
                            handleLandedCostChange(idx, 'costType', val)
                          }
                        >
                          <SelectTrigger className="w-full bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="freight">Freight / Shipping</SelectItem>
                            <SelectItem value="duty">Customs & Excise Duty</SelectItem>
                            <SelectItem value="clearing">Clearing & Forwarding</SelectItem>
                            <SelectItem value="other">Other Landed Cost</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          type="number"
                          step="0.0001"
                          min="0"
                          value={lc.amount}
                          onChange={(e) =>
                            handleLandedCostChange(idx, 'amount', e.target.value)
                          }
                          className="bg-white"
                          required
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Select
                          value={lc.currency}
                          onValueChange={(val) =>
                            handleLandedCostChange(idx, 'currency', val)
                          }
                        >
                          <SelectTrigger className="w-full bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MWK">MWK</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="ZAR">ZAR</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          type="number"
                          step="0.000001"
                          min="0.000001"
                          value={lc.exchangeRate}
                          onChange={(e) =>
                            handleLandedCostChange(idx, 'exchangeRate', e.target.value)
                          }
                          disabled={lc.currency === 'MWK'}
                          className="bg-white"
                          required
                        />
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-medium text-purple-700">
                        {formatMwk(mwkMinor)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveLandedCost(idx)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Receipt Totals Summary */}
        <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <span className="text-xs text-ace-muted block">Items Value (MWK)</span>
            <span className="text-lg font-bold text-ace-navy font-mono">
              {formatMwk(totalItemsMwkMinor)}
            </span>
          </div>

          <div className="bg-purple-50 rounded-lg p-3">
            <span className="text-xs text-purple-900 block">Total Landed Costs (MWK)</span>
            <span className="text-lg font-bold text-purple-700 font-mono">
              {formatMwk(totalLandedMwkMinor)}
            </span>
          </div>

          <div className="bg-emerald-50 rounded-lg p-3">
            <span className="text-xs text-emerald-900 block">Total Landed Inventory (MWK)</span>
            <span className="text-lg font-bold text-emerald-700 font-mono">
              {formatMwk(totalItemsMwkMinor + totalLandedMwkMinor)}
            </span>
          </div>
        </div>
      </div>
    </form>
  );
}
