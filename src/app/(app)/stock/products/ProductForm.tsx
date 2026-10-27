'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { createProductAction, updateProductAction } from './actions';
import { parseKwachaToMinor, formatMwk } from '@/lib/money';
import { Trash2, Plus } from 'lucide-react';

interface Category { id: string; name: string }
interface UOM { id: string; name: string; symbol: string; allowDecimal: boolean }
interface TaxRate { id: string; name: string; rateBasisPoints: number }
interface ProductBasic { id: string; name: string; sku: string; productType: string | null }

interface ProductData {
  id?: string;
  name: string;
  sku: string;
  barcode?: string | null;
  description?: string | null;
  categoryId?: string | null;
  uomId: string;
  productType?: 'standard' | 'bundle' | 'service' | string | null;
  sellingPriceMinor: number;
  taxRateId?: string | null;
  minStockAlert?: string | null;
  maxStock?: string | null;
  serialTracking?: boolean;
  warrantyMonths?: number;
  isActive?: boolean;
  bundleComponents?: Array<{ componentProductId: string; quantity: string }>;
}

interface Props {
  product?: ProductData;
  categories: Category[];
  uoms: UOM[];
  taxRates: TaxRate[];
  allProducts: ProductBasic[];
  isEditing: boolean;
}

export function ProductForm({ product, categories, uoms, taxRates, allProducts, isEditing }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
  const [uomId, setUomId] = useState(product?.uomId ?? '');
  const [productType, setProductType] = useState<'standard' | 'bundle' | 'service'>(
    (product?.productType as any) ?? 'standard',
  );
  const [sellingPriceInput, setSellingPriceInput] = useState(
    product ? (product.sellingPriceMinor / 100).toFixed(2) : '',
  );
  const [taxRateId, setTaxRateId] = useState(product?.taxRateId ?? '');
  const [minStock, setMinStock] = useState(product?.minStockAlert ?? '');
  const [maxStock, setMaxStock] = useState(product?.maxStock ?? '');
  const [serialTracking, setSerialTracking] = useState(product?.serialTracking ?? false);
  const [warrantyMonths, setWarrantyMonths] = useState(product?.warrantyMonths?.toString() ?? '0');
  const [isActive, setIsActive] = useState(product?.isActive ?? true);

  // Bundle builder
  const [bundleLines, setBundleLines] = useState<Array<{ componentProductId: string; quantity: string }>>(
    product?.bundleComponents?.map((c) => ({ componentProductId: c.componentProductId, quantity: c.quantity })) ?? [
      { componentProductId: '', quantity: '1' },
    ],
  );

  const addBundleLine = () => setBundleLines((prev) => [...prev, { componentProductId: '', quantity: '1' }]);
  const removeBundleLine = (i: number) => setBundleLines((prev) => prev.filter((_, idx) => idx !== i));
  const updateBundleLine = (i: number, field: 'componentProductId' | 'quantity', val: string) => {
    setBundleLines((prev) => prev.map((line, idx) => idx === i ? { ...line, [field]: val } : line));
  };

  const eligibleComponents = allProducts.filter(
    (p) => p.productType !== 'bundle' && p.productType !== 'service' && p.id !== product?.id,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let sellingPriceMinor: number;
    try {
      sellingPriceMinor = parseKwachaToMinor(sellingPriceInput);
    } catch {
      toast.error('Invalid selling price — enter a number like 15000 or 15,000.00');
      return;
    }

    startTransition(async () => {
      try {
        if (isEditing && product?.id) {
          await updateProductAction(product.id, {
            name, barcode: barcode || null, description: description || null,
            categoryId: categoryId || null, uomId,
            sellingPriceMinor, taxRateId: taxRateId || null,
            minStockAlert: minStock || null, maxStock: maxStock || null,
            serialTracking: productType !== 'service' ? serialTracking : false,
            warrantyMonths: parseInt(warrantyMonths) || 0,
            isActive,
            bundleComponents: productType === 'bundle' ? bundleLines.filter((l) => l.componentProductId) : undefined,
          });
          toast.success('Product updated successfully');
          router.refresh();
        } else {
          const result = await createProductAction({
            name, sku, barcode: barcode || null, description: description || null,
            categoryId: categoryId || null, uomId, productType,
            sellingPriceMinor, taxRateId: taxRateId || null,
            minStockAlert: minStock || null, maxStock: maxStock || null,
            serialTracking: productType !== 'service' ? serialTracking : false,
            warrantyMonths: parseInt(warrantyMonths) || 0,
            isActive,
            bundleComponents: productType === 'bundle' ? bundleLines.filter((l) => l.componentProductId) : undefined,
          });
          toast.success('Product created successfully');
          router.push(`/stock/products/${result.product.id}`);
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to save product');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Details */}
      <div className="rounded-lg border bg-white p-5 shadow-sm space-y-4">
        <h2 className="font-semibold text-ace-navy">Basic Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="p-name">Product Name *</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-sku">SKU *</Label>
            <Input
              id="p-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value.toUpperCase())}
              required
              disabled={isEditing}
              className={isEditing ? 'bg-gray-50 text-ace-muted cursor-not-allowed' : ''}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-barcode">Barcode (optional)</Label>
            <Input id="p-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Scan or type…" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="p-desc">Description (optional)</Label>
            <Input id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Classification */}
      <div className="rounded-lg border bg-white p-5 shadow-sm space-y-4">
        <h2 className="font-semibold text-ace-navy">Classification</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="p-type">Product Type *</Label>
            <Select
              value={productType}
              onValueChange={(v: 'standard' | 'bundle' | 'service') => setProductType(v)}
              disabled={isEditing}
            >
              <SelectTrigger id="p-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard (stocked item)</SelectItem>
                <SelectItem value="bundle">Bundle (kit of items)</SelectItem>
                <SelectItem value="service">Service (no stock)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-cat">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="p-cat">
                <SelectValue placeholder="Uncategorized" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Uncategorized</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-uom">Unit of Measure *</Label>
            <Select value={uomId} onValueChange={setUomId} required>
              <SelectTrigger id="p-uom">
                <SelectValue placeholder="Select UOM" />
              </SelectTrigger>
              <SelectContent>
                {uoms.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name} ({u.symbol})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-tax">VAT Rate</Label>
            <Select value={taxRateId} onValueChange={setTaxRateId}>
              <SelectTrigger id="p-tax">
                <SelectValue placeholder="No VAT" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">No VAT (zero-rated)</SelectItem>
                {taxRates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({(t.rateBasisPoints / 100).toFixed(1)}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div className="rounded-lg border bg-white p-5 shadow-sm space-y-4">
        <h2 className="font-semibold text-ace-navy">Pricing</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="p-price">Selling Price (MWK) *</Label>
            <Input
              id="p-price"
              value={sellingPriceInput}
              onChange={(e) => setSellingPriceInput(e.target.value)}
              placeholder="e.g. 15000.00"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-warranty">Warranty (months)</Label>
            <Input
              id="p-warranty"
              type="number"
              min="0"
              value={warrantyMonths}
              onChange={(e) => setWarrantyMonths(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Stock Alerts (only for standard products) */}
      {productType === 'standard' && (
        <div className="rounded-lg border bg-white p-5 shadow-sm space-y-4">
          <h2 className="font-semibold text-ace-navy">Stock Controls</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="p-minstock">Low Stock Alert Level</Label>
              <Input
                id="p-minstock"
                type="number"
                min="0"
                step="0.001"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                placeholder="e.g. 5"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-maxstock">Max Stock Level</Label>
              <Input
                id="p-maxstock"
                type="number"
                min="0"
                step="0.001"
                value={maxStock}
                onChange={(e) => setMaxStock(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="p-serial">Serial Number Tracking</Label>
              <p className="text-xs text-ace-muted">Each unit has a unique serial. Required on receipt and sales.</p>
            </div>
            <Switch
              id="p-serial"
              checked={serialTracking}
              onCheckedChange={setSerialTracking}
            />
          </div>
        </div>
      )}

      {/* Bundle Components */}
      {productType === 'bundle' && (
        <div className="rounded-lg border bg-white p-5 shadow-sm space-y-4">
          <h2 className="font-semibold text-ace-navy">Bundle Components</h2>
          <p className="text-xs text-ace-muted">Bundle sells as a kit. Components are deducted from stock on each sale.</p>
          <div className="space-y-3">
            {bundleLines.map((line, i) => (
              <div key={i} className="flex items-center gap-3">
                <Select
                  value={line.componentProductId}
                  onValueChange={(v) => updateBundleLine(i, 'componentProductId', v)}
                >
                  <SelectTrigger className="flex-1" id={`bundle-comp-${i}`}>
                    <SelectValue placeholder="Select component product" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleComponents.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="w-24"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={line.quantity}
                  onChange={(e) => updateBundleLine(i, 'quantity', e.target.value)}
                  id={`bundle-qty-${i}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeBundleLine(i)}
                  disabled={bundleLines.length <= 1}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addBundleLine}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Component
            </Button>
          </div>
        </div>
      )}

      {/* Status */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="p-active">Product Active</Label>
            <p className="text-xs text-ace-muted mt-0.5">Inactive products cannot be sold or purchased</p>
          </div>
          <Switch id="p-active" checked={isActive} onCheckedChange={setIsActive} />
        </div>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={isPending} id="save-product-btn">
          {isPending ? 'Saving…' : isEditing ? 'Update Product' : 'Create Product'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push('/stock/products')}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
