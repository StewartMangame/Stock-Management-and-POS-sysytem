'use client';

import { useState, useTransition } from 'react';
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
import { createPurchaseOrderAction } from './actions';
import { formatMwk } from '@/lib/money';
import { Plus, Trash2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

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
  lastCostMinor: number;
}

interface LineItem {
  productId: string;
  orderedQty: string;
  unitCostSupplier: string;
}

interface Props {
  suppliers: Supplier[];
  locations: Location[];
  products: Product[];
}

export function POForm({ suppliers, locations, products }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]!);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [currency, setCurrency] = useState('MWK');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [notes, setNotes] = useState('');

  const [items, setItems] = useState<LineItem[]>([
    { productId: '', orderedQty: '1', unitCostSupplier: '0' },
  ]);

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
    setItems((prev) => [...prev, { productId: '', orderedQty: '1', unitCostSupplier: '0' }]);
  };

  const handleRemoveLine = (index: number) => {
    if (items.length <= 1) {
      toast.error('A purchase order must have at least one line item.');
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof LineItem, value: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index]!, [field]: value };
      if (field === 'productId') {
        const prod = products.find((p) => p.id === value);
        if (prod && currency === 'MWK' && Number(next[index]!.unitCostSupplier) === 0) {
          next[index]!.unitCostSupplier = (prod.lastCostMinor / 100).toString();
        }
      }
      return next;
    });
  };

  // Calculations
  const rateNum = Number(exchangeRate) || 1;
  const lineCalculations = items.map((it) => {
    const qty = Number(it.orderedQty) || 0;
    const unitCost = Number(it.unitCostSupplier) || 0;
    const totalSupplier = qty * unitCost;
    const totalMwkMinor = Math.round(totalSupplier * rateNum * 100);
    return { totalSupplier, totalMwkMinor };
  });

  const grandTotalSupplier = lineCalculations.reduce((sum, c) => sum + c.totalSupplier, 0);
  const grandTotalMwkMinor = lineCalculations.reduce((sum, c) => sum + c.totalMwkMinor, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!supplierId) {
      toast.error('Please select a supplier.');
      return;
    }
    if (!locationId) {
      toast.error('Please select a destination location.');
      return;
    }
    if (items.some((it) => !it.productId || Number(it.orderedQty) <= 0)) {
      toast.error('Please choose a product and positive quantity for all lines.');
      return;
    }

    startTransition(async () => {
      try {
        const res = await createPurchaseOrderAction({
          supplierId,
          locationId,
          orderDate,
          expectedDeliveryDate: expectedDeliveryDate || null,
          currency,
          exchangeRate: Number(exchangeRate) || 1,
          notes: notes.trim() || null,
          items: items.map((it) => ({
            productId: it.productId,
            orderedQty: it.orderedQty,
            unitCostSupplier: it.unitCostSupplier,
          })),
        });

        if (res.success && res.po) {
          toast.success(`Purchase order ${res.po.poNumber} created successfully!`);
          router.push(`/purchasing/orders/${res.po.id}`);
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to create purchase order.');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/purchasing/orders">
            <Button variant="ghost" size="icon" type="button">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-ace-navy">Create Purchase Order</h1>
            <p className="text-sm text-ace-muted">Draft a new order for domestic or foreign suppliers.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/purchasing/orders">
            <Button variant="outline" type="button">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={isPending} id="save-po-btn">
            {isPending ? 'Saving Order...' : 'Create Purchase Order'}
          </Button>
        </div>
      </div>

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
                  {s.name} ({s.code}) — {s.defaultCurrency || 'MWK'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="locationId">Destination Location *</Label>
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

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="orderDate">Order Date</Label>
            <Input
              id="orderDate"
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expectedDeliveryDate">Expected Date</Label>
            <Input
              id="expectedDeliveryDate"
              type="date"
              value={expectedDeliveryDate}
              onChange={(e) => setExpectedDeliveryDate(e.target.value)}
            />
          </div>
        </div>

        {/* Currency & Exchange Rate */}
        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
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
              <SelectItem value="CNY">CNY — Chinese Yuan</SelectItem>
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

        <div className="space-y-2">
          <Label htmlFor="notes">Notes / References</Label>
          <Input
            id="notes"
            placeholder="Proforma invoice #, shipping terms, etc."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {/* Line Items */}
      <div className="rounded-lg border bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ace-navy">Order Line Items</h2>
          <Button type="button" variant="outline" size="sm" onClick={handleAddLine} id="add-line-btn">
            <Plus className="h-4 w-4 mr-1" />
            Add Product Line
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-xs font-semibold text-gray-600">
                <th className="py-2.5 px-3">Product</th>
                <th className="py-2.5 px-3 w-32">Qty</th>
                <th className="py-2.5 px-3 w-40">Unit Cost ({currency})</th>
                <th className="py-2.5 px-3 w-40 text-right">Line Total ({currency})</th>
                <th className="py-2.5 px-3 w-44 text-right">MWK Total</th>
                <th className="py-2.5 px-3 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item, idx) => (
                <tr key={idx} className="hover:bg-gray-50/50">
                  <td className="py-2 px-3">
                    <Select
                      value={item.productId}
                      onValueChange={(val) => handleItemChange(idx, 'productId', val)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select product..." />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-2 px-3">
                    <Input
                      type="number"
                      step="0.001"
                      min="0.001"
                      value={item.orderedQty}
                      onChange={(e) => handleItemChange(idx, 'orderedQty', e.target.value)}
                      required
                    />
                  </td>
                  <td className="py-2 px-3">
                    <Input
                      type="number"
                      step="0.0001"
                      min="0"
                      value={item.unitCostSupplier}
                      onChange={(e) => handleItemChange(idx, 'unitCostSupplier', e.target.value)}
                      required
                    />
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-medium">
                    {lineCalculations[idx]?.totalSupplier.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    {currency}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-ace-navy font-semibold">
                    {formatMwk(lineCalculations[idx]?.totalMwkMinor ?? 0)}
                  </td>
                  <td className="py-2 px-3 text-center">
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
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold bg-gray-50/80">
                <td colSpan={3} className="py-3 px-3 text-right text-gray-700">
                  Grand Total:
                </td>
                <td className="py-3 px-3 text-right font-mono text-ace-blue text-base">
                  {grandTotalSupplier.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  {currency}
                </td>
                <td className="py-3 px-3 text-right font-mono text-ace-navy text-base font-bold">
                  {formatMwk(grandTotalMwkMinor)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </form>
  );
}
