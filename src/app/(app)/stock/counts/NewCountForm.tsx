'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus } from 'lucide-react';
import { createStockCountAction } from './actions';

interface Location { id: string; name: string }
interface Product { id: string; name: string; sku: string; productType: string | null }

interface Props {
  locations: Location[];
  products: Product[];
}

interface CountLine {
  productId: string;
  countedQty: string;
}

export function NewCountForm({ locations, products }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [locationId, setLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<CountLine[]>([{ productId: '', countedQty: '0' }]);

  const stockableProducts = products.filter(
    (p) => p.productType !== 'service' && p.productType !== 'non-inventory',
  );

  const addLine = () => setLines((prev) => [...prev, { productId: '', countedQty: '0' }]);
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof CountLine, val: string) =>
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationId) { toast.error('Please select a location'); return; }
    const validLines = lines.filter((l) => l.productId);
    if (validLines.length === 0) { toast.error('Add at least one product to count'); return; }

    startTransition(async () => {
      try {
        const result = await createStockCountAction({
          locationId,
          notes: notes || null,
          items: validLines.map((l) => ({
            productId: l.productId,
            countedQty: l.countedQty,
          })),
        });
        toast.success('Stock count created — proceed to reconciliation');
        router.push(`/stock/counts/${result.count.id}`);
      } catch (err: any) {
        toast.error(err.message || 'Failed to create count');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-lg border bg-white p-5 shadow-sm space-y-4">
        <h2 className="font-semibold text-ace-navy">Count Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5 col-span-2 sm:col-span-1">
            <Label htmlFor="cnt-location">Location *</Label>
            <Select value={locationId} onValueChange={setLocationId} required>
              <SelectTrigger id="cnt-location">
                <SelectValue placeholder="Select location…" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="cnt-notes">Notes</Label>
            <Input
              id="cnt-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Monthly cycle count — Warehouse A"
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ace-navy">Products to Count</h2>
          <p className="text-xs text-ace-muted">Enter the physically counted quantities</p>
        </div>
        <div className="space-y-3">
          {lines.map((line, i) => (
            <div key={i} className="flex gap-3 items-end">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Product</Label>
                <Select value={line.productId} onValueChange={(v) => updateLine(i, 'productId', v)}>
                  <SelectTrigger id={`cnt-product-${i}`}>
                    <SelectValue placeholder="Select product…" />
                  </SelectTrigger>
                  <SelectContent>
                    {stockableProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28 space-y-1">
                <Label className="text-xs">Counted Qty</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={line.countedQty}
                  onChange={(e) => updateLine(i, 'countedQty', e.target.value)}
                  id={`cnt-qty-${i}`}
                />
              </div>
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
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Product
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <strong>Note:</strong> When you submit, a count record is created with your counted quantities.
        Reconciliation against live inventory happens under a row-level lock when you proceed to the
        count detail page. You will be warned if any movements occurred after the count started.
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={isPending} id="submit-count-btn">
          {isPending ? 'Creating…' : 'Create Count & Reconcile'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/stock/counts')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
