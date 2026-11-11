'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus } from 'lucide-react';
import { createStockAdjustmentAction } from './actions';
import { parseKwachaToMinor } from '@/lib/money';

interface Location { id: string; name: string }
interface Product { id: string; name: string; sku: string; productType: string | null; avgCostMinor: number | null }

interface Props {
  locations: Location[];
  products: Product[];
}

interface AdjLine {
  productId: string;
  quantity: string;
  unitCostMinorInput: string;
  serialNumbers: string;
}

export function AdjustmentForm({ locations, products }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [locationId, setLocationId] = useState('');
  const [type, setType] = useState<'in' | 'out'>('out');
  const [reason, setReason] = useState<'damaged' | 'expired' | 'internal_use' | 'found' | 'correction'>('damaged');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<AdjLine[]>([
    { productId: '', quantity: '1', unitCostMinorInput: '', serialNumbers: '' },
  ]);

  const stockableProducts = products.filter(
    (p) => p.productType !== 'service' && p.productType !== 'non-inventory',
  );

  const addLine = () =>
    setLines((prev) => [...prev, { productId: '', quantity: '1', unitCostMinorInput: '', serialNumbers: '' }]);

  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const updateLine = (i: number, field: keyof AdjLine, val: string) =>
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));

  const REASON_OPTIONS = [
    { value: 'damaged', label: 'Damaged / Write-off' },
    { value: 'expired', label: 'Expired' },
    { value: 'internal_use', label: 'Internal Use' },
    { value: 'found', label: 'Found / Surplus' },
    { value: 'correction', label: 'Quantity Correction' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationId) { toast.error('Please select a location'); return; }

    const validLines = lines.filter((l) => l.productId && parseFloat(l.quantity) > 0);
    if (validLines.length === 0) { toast.error('Add at least one product line'); return; }

    startTransition(async () => {
      try {
        const items = validLines.map((l) => {
          let unitCostMinor: number | undefined;
          if (l.unitCostMinorInput.trim()) {
            try { unitCostMinor = parseKwachaToMinor(l.unitCostMinorInput); } catch { /* skip */ }
          }
          return {
            productId: l.productId,
            quantity: l.quantity,
            unitCostMinor,
            serialNumbers: l.serialNumbers
              ? l.serialNumbers.split(',').map((s) => s.trim()).filter(Boolean)
              : undefined,
          };
        });

        await createStockAdjustmentAction({
          locationId,
          type,
          reason,
          notes: notes || null,
          items,
        });

        toast.success('Stock adjustment created and applied');
        router.push('/stock/adjustments');
      } catch (err: any) {
        toast.error(err.message || 'Failed to create adjustment');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border bg-white p-5 shadow-sm space-y-4">
        <h2 className="font-semibold text-ace-navy">Adjustment Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="adj-location">Location *</Label>
            <Select value={locationId} onValueChange={setLocationId} required>
              <SelectTrigger id="adj-location">
                <SelectValue placeholder="Select location…" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adj-type">Adjustment Type *</Label>
            <Select value={type} onValueChange={(v: 'in' | 'out') => setType(v)}>
              <SelectTrigger id="adj-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="out">Stock OUT ↓ (reduce stock)</SelectItem>
                <SelectItem value="in">Stock IN ↑ (increase stock)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adj-reason">Reason *</Label>
            <Select value={reason} onValueChange={(v: any) => setReason(v)}>
              <SelectTrigger id="adj-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="adj-notes">Notes / Authorisation Reference</Label>
            <Input
              id="adj-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Manager authorisation ref MGR-2024-001"
            />
          </div>
        </div>
      </div>

      {/* Lines */}
      <div className="rounded-lg border bg-white p-5 shadow-sm space-y-4">
        <h2 className="font-semibold text-ace-navy">Products to Adjust</h2>
        <div className="space-y-3">
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-4 space-y-1">
                <Label className="text-xs">Product</Label>
                <Select value={line.productId} onValueChange={(v) => updateLine(i, 'productId', v)}>
                  <SelectTrigger id={`adj-product-${i}`}>
                    <SelectValue placeholder="Select product…" />
                  </SelectTrigger>
                  <SelectContent>
                    {stockableProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={line.quantity}
                  onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                  id={`adj-qty-${i}`}
                />
              </div>
              <div className="col-span-3 space-y-1">
                <Label className="text-xs">Unit Cost MWK {type === 'in' ? '(if IN with no stock)' : '(optional)'}</Label>
                <Input
                  type="text"
                  value={line.unitCostMinorInput}
                  onChange={(e) => updateLine(i, 'unitCostMinorInput', e.target.value)}
                  placeholder="e.g. 15000.00"
                  id={`adj-cost-${i}`}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Serial Nos (comma sep.)</Label>
                <Input
                  value={line.serialNumbers}
                  onChange={(e) => updateLine(i, 'serialNumbers', e.target.value)}
                  placeholder="SN001, SN002"
                  id={`adj-serials-${i}`}
                />
              </div>
              <div className="col-span-1 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLine(i)}
                  disabled={lines.length <= 1}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Line
          </Button>
        </div>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={isPending} id="submit-adjustment-btn">
          {isPending ? 'Posting…' : 'Post Adjustment'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/stock/adjustments')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
