'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { createProductAction, updateProductAction } from './actions';
import { parseKwachaToMinor } from '@/lib/money';
import {
  Trash2,
  Plus,
  Upload,
  Image as ImageIcon,
  X,
  Calendar,
  Package,
  Layers,
  Wrench,
  Boxes,
  AlertCircle,
} from 'lucide-react';
import { UomDialog, type UOMItem } from './UomDialog';
import { CategoryDialog, type CategoryItem } from '@/app/(app)/stock/categories/CategoryDialog';

interface Category {
  id: string;
  name: string;
}
interface UOM {
  id: string;
  name: string;
  symbol: string;
  allowDecimal: boolean;
}
interface TaxRate {
  id: string;
  name: string;
  rateBasisPoints: number;
  isDefault?: boolean | null;
}
interface ProductBasic {
  id: string;
  name: string;
  sku: string;
  productType: string | null;
}

interface LocationItem {
  id: string;
  name: string;
  code?: string;
}

interface ProductData {
  id?: string;
  name: string;
  sku: string;
  barcode?: string | null;
  description?: string | null;
  categoryId?: string | null;
  uomId: string;
  productType?: 'inventory' | 'non-inventory' | 'service' | 'bundle' | 'standard' | string | null;
  productDate?: string | Date | null;
  imageUrl?: string | null;
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
  locations?: LocationItem[];
  isEditing: boolean;
  defaultTaxRateId?: string;
}

export function ProductForm({
  product,
  categories,
  uoms,
  taxRates,
  allProducts,
  locations = [],
  isEditing,
  defaultTaxRateId,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Normalize initial product type (map legacy 'standard' to 'inventory')
  const initialType = product?.productType === 'standard' ? 'inventory' : product?.productType ?? 'inventory';

  // Normalize initial product date
  const getInitialDate = () => {
    if (product?.productDate) {
      if (typeof product.productDate === 'string') {
        return product.productDate.slice(0, 10);
      }
      try {
        return product.productDate.toISOString().slice(0, 10);
      } catch {
        return new Date().toISOString().slice(0, 10);
      }
    }
    return new Date().toISOString().slice(0, 10);
  };

  // Form states
  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [productDate, setProductDate] = useState(getInitialDate());
  const [dateError, setDateError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? '');

  const [categoriesList, setCategoriesList] = useState<Category[]>(categories);
  const [isCatDialogOpen, setIsCatDialogOpen] = useState(false);
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');

  const [uomsList, setUomsList] = useState<UOM[]>(uoms);
  const [isUomDialogOpen, setIsUomDialogOpen] = useState(false);
  const [uomId, setUomId] = useState(product?.uomId ?? '');

  const [productType, setProductType] = useState<'inventory' | 'non-inventory' | 'service' | 'bundle'>(
    (initialType as any) || 'inventory',
  );

  // Initial stock states (new products only)
  const [initialQuantity, setInitialQuantity] = useState('');
  const [initialLocationId, setInitialLocationId] = useState(locations?.[0]?.id ?? '');
  const [initialCostInput, setInitialCostInput] = useState('');
  const [initialSerials, setInitialSerials] = useState('');

  const [sellingPriceInput, setSellingPriceInput] = useState(
    product ? (product.sellingPriceMinor / 100).toFixed(2) : '',
  );

  const defaultRate = taxRates.find((t) => t.isDefault)?.id ?? defaultTaxRateId ?? '';
  const [taxRateId, setTaxRateId] = useState(product?.taxRateId ?? defaultRate);

  const [minStock, setMinStock] = useState(product?.minStockAlert ?? '');
  const [maxStock, setMaxStock] = useState(product?.maxStock ?? '');
  const [serialTracking, setSerialTracking] = useState(product?.serialTracking ?? false);
  const [warrantyMonths, setWarrantyMonths] = useState(product?.warrantyMonths?.toString() ?? '0');
  const [isActive, setIsActive] = useState(product?.isActive ?? true);

  // Bundle builder state
  const [bundleLines, setBundleLines] = useState<Array<{ componentProductId: string; quantity: string }>>(
    product?.bundleComponents?.map((c) => ({ componentProductId: c.componentProductId, quantity: c.quantity })) ?? [
      { componentProductId: '', quantity: '1' },
    ],
  );

  const addBundleLine = () => setBundleLines((prev) => [...prev, { componentProductId: '', quantity: '1' }]);
  const removeBundleLine = (i: number) => setBundleLines((prev) => prev.filter((_, idx) => idx !== i));
  const updateBundleLine = (i: number, field: 'componentProductId' | 'quantity', val: string) => {
    setBundleLines((prev) => prev.map((line, idx) => (idx === i ? { ...line, [field]: val } : line)));
  };

  const eligibleComponents = allProducts.filter(
    (p) =>
      p.productType !== 'bundle' &&
      p.productType !== 'service' &&
      p.productType !== 'non-inventory' &&
      p.id !== product?.id,
  );

  // Validate date format and validity
  const validateDate = (val: string): boolean => {
    if (!val || val.trim() === '') {
      setDateError('Date is required');
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      setDateError('Use YYYY-MM-DD');
      return false;
    }
    const d = new Date(val);
    if (isNaN(d.getTime())) {
      setDateError('Invalid date');
      return false;
    }
    setDateError(null);
    return true;
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Selected file is not an image');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be under 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImageUrl(reader.result as string);
      toast.success('Image loaded');
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateDate(productDate)) {
      toast.error('Please enter a valid product date (YYYY-MM-DD)');
      return;
    }

    let sellingPriceMinor: number;
    try {
      sellingPriceMinor = parseKwachaToMinor(sellingPriceInput);
    } catch {
      toast.error('Invalid selling price');
      return;
    }

    const isStockable = productType === 'inventory';

    let initialQtyNum = 0;
    let initialUnitCostMinor = 0;
    let serialsArray: string[] | undefined = undefined;

    if (!isEditing && isStockable) {
      if (initialQuantity.trim()) {
        initialQtyNum = parseFloat(initialQuantity);
        if (isNaN(initialQtyNum) || initialQtyNum < 0) {
          toast.error('Initial quantity must be a non-negative number');
          return;
        }
      }

      if (initialCostInput.trim()) {
        try {
          initialUnitCostMinor = parseKwachaToMinor(initialCostInput);
        } catch {
          toast.error('Invalid initial unit cost');
          return;
        }
      }

      if (serialTracking && initialQtyNum > 0) {
        serialsArray = initialSerials
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const requiredCount = Math.floor(initialQtyNum);
        if (serialsArray.length !== requiredCount) {
          toast.error(
            `Serial tracking enabled: enter exactly ${requiredCount} serial number(s) (provided: ${serialsArray.length})`,
          );
          return;
        }
      }
    }

    startTransition(async () => {
      try {
        if (isEditing && product?.id) {
          await updateProductAction(product.id, {
            name,
            barcode: barcode || null,
            description: description || null,
            categoryId: categoryId || null,
            uomId,
            productDate,
            imageUrl: imageUrl || null,
            sellingPriceMinor,
            taxRateId: taxRateId || null,
            minStockAlert: isStockable ? (minStock || null) : null,
            maxStock: isStockable ? (maxStock || null) : null,
            serialTracking: isStockable ? serialTracking : false,
            warrantyMonths: parseInt(warrantyMonths) || 0,
            isActive,
            bundleComponents: productType === 'bundle' ? bundleLines.filter((l) => l.componentProductId) : undefined,
          });
          toast.success('Product updated');
          router.refresh();
        } else {
          const result = await createProductAction({
            name,
            sku,
            barcode: barcode || null,
            description: description || null,
            categoryId: categoryId || null,
            uomId,
            productType,
            productDate,
            imageUrl: imageUrl || null,
            sellingPriceMinor,
            taxRateId: taxRateId || null,
            minStockAlert: isStockable ? (minStock || null) : null,
            maxStock: isStockable ? (maxStock || null) : null,
            serialTracking: isStockable ? serialTracking : false,
            warrantyMonths: parseInt(warrantyMonths) || 0,
            isActive,
            bundleComponents: productType === 'bundle' ? bundleLines.filter((l) => l.componentProductId) : undefined,
            initialQuantity: isStockable && initialQtyNum > 0 ? initialQtyNum : undefined,
            initialLocationId: isStockable && initialQtyNum > 0 ? (initialLocationId || undefined) : undefined,
            initialUnitCostMinor:
              isStockable && initialQtyNum > 0 && initialUnitCostMinor > 0 ? initialUnitCostMinor : undefined,
            initialSerialNumbers:
              isStockable && serialsArray && serialsArray.length > 0 ? serialsArray : undefined,
          });
          toast.success('Product created');
          router.push(`/stock/products/${result.product.id}`);
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to save product');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* ── Section 1: Product Identification ── */}
      <div className="rounded-xl border bg-white p-5 shadow-xs space-y-4">
        <h2 className="font-semibold text-base text-ace-navy">Product Identification</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Image Box */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-ace-navy">Product Image</Label>
            <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50/50 p-3 flex flex-col items-center justify-center text-center">
              {imageUrl ? (
                <div className="relative w-full aspect-square max-w-[180px] rounded-lg overflow-hidden border bg-white shadow-xs group">
                  <img
                    src={imageUrl}
                    alt="Product"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setImageUrl('')}
                    className="absolute top-1.5 right-1.5 bg-black/60 text-white p-1 rounded-full hover:bg-red-600 transition"
                    title="Remove image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="py-5 flex flex-col items-center gap-2">
                  <div className="p-2.5 bg-white rounded-full border text-ace-muted">
                    <ImageIcon className="w-6 h-6 text-gray-400" />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs h-7"
                  >
                    <Upload className="w-3 h-3 mr-1" />
                    Upload Image
                  </Button>
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageFileChange}
            />

            <Input
              type="url"
              placeholder="Or paste image URL"
              value={imageUrl.startsWith('data:') ? '' : imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              className="text-xs h-8"
            />
          </div>

          {/* Core Info */}
          <div className="md:col-span-2 space-y-3.5">
            <div className="space-y-1">
              <Label htmlFor="p-name" className="text-xs font-semibold text-ace-navy">
                Product Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="p-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Product name"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1">
                <Label htmlFor="p-sku" className="text-xs font-semibold text-ace-navy">
                  SKU <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="p-sku"
                  value={sku}
                  onChange={(e) => setSku(e.target.value.toUpperCase())}
                  required
                  disabled={isEditing}
                  placeholder="e.g. PROD-001"
                  className={isEditing ? 'bg-gray-50 text-ace-muted cursor-not-allowed font-mono text-xs' : 'font-mono text-xs uppercase'}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="p-barcode" className="text-xs font-semibold text-ace-navy">
                  Barcode (Optional)
                </Label>
                <Input
                  id="p-barcode"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="Scan or enter barcode"
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1">
                <Label htmlFor="p-date" className="text-xs font-semibold text-ace-navy flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-ace-blue" />
                  Product Date <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="p-date"
                    type="date"
                    value={productDate}
                    onChange={(e) => {
                      setProductDate(e.target.value);
                      validateDate(e.target.value);
                    }}
                    required
                    className={dateError ? 'border-red-500 pr-8' : ''}
                  />
                  {dateError && (
                    <AlertCircle className="w-4 h-4 text-red-500 absolute right-2.5 top-2.5 pointer-events-none" />
                  )}
                </div>
                {dateError && <p className="text-xs text-red-500 font-medium">{dateError}</p>}
              </div>

              <div className="space-y-1">
                <Label htmlFor="p-warranty" className="text-xs font-semibold text-ace-navy">
                  Warranty (Months)
                </Label>
                <Input
                  id="p-warranty"
                  type="number"
                  min="0"
                  value={warrantyMonths}
                  onChange={(e) => setWarrantyMonths(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="p-desc" className="text-xs font-semibold text-ace-navy">
                Description (Optional)
              </Label>
              <Input
                id="p-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional notes or details"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 2: Classification ── */}
      <div className="rounded-xl border bg-white p-5 shadow-xs space-y-4">
        <h2 className="font-semibold text-base text-ace-navy">Classification</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Product Type */}
          <div className="space-y-1">
            <Label htmlFor="p-type" className="text-xs font-semibold text-ace-navy">
              Product Type <span className="text-red-500">*</span>
            </Label>
            <Select
              value={productType}
              onValueChange={(v: 'inventory' | 'non-inventory' | 'service' | 'bundle') => setProductType(v)}
              disabled={isEditing}
            >
              <SelectTrigger id="p-type" className="font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inventory">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-emerald-600" />
                    <span>Inventory</span>
                  </div>
                </SelectItem>
                <SelectItem value="non-inventory">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-600" />
                    <span>Non-Inventory</span>
                  </div>
                </SelectItem>
                <SelectItem value="service">
                  <div className="flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-blue-600" />
                    <span>Service</span>
                  </div>
                </SelectItem>
                <SelectItem value="bundle">
                  <div className="flex items-center gap-2">
                    <Boxes className="w-4 h-4 text-purple-600" />
                    <span>Bundle / Kit</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Category */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="p-cat" className="text-xs font-semibold text-ace-navy">Category</Label>
              <button
                type="button"
                onClick={() => setIsCatDialogOpen(true)}
                className="text-xs text-ace-blue hover:text-ace-navy hover:underline font-medium inline-flex items-center gap-0.5 cursor-pointer"
              >
                <Plus className="w-3 h-3" /> New
              </button>
            </div>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="p-cat">
                <SelectValue placeholder="Uncategorized" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Uncategorized</SelectItem>
                {categoriesList.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Unit of Measure */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="p-uom" className="text-xs font-semibold text-ace-navy">
                Unit of Measure <span className="text-red-500">*</span>
              </Label>
              <button
                type="button"
                onClick={() => setIsUomDialogOpen(true)}
                className="text-xs text-ace-blue hover:text-ace-navy hover:underline font-medium inline-flex items-center gap-0.5 cursor-pointer"
              >
                <Plus className="w-3 h-3" /> New
              </button>
            </div>
            <Select value={uomId} onValueChange={setUomId} required>
              <SelectTrigger id="p-uom">
                <SelectValue placeholder="Select UOM" />
              </SelectTrigger>
              <SelectContent>
                {uomsList.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} ({u.symbol})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── Section 3: Pricing & Tax ── */}
      <div className="rounded-xl border bg-white p-5 shadow-xs space-y-4">
        <h2 className="font-semibold text-base text-ace-navy">Pricing & Tax</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="p-price" className="text-xs font-semibold text-ace-navy">
              Selling Price (MWK) <span className="text-red-500">*</span>
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs font-bold text-ace-muted">MWK</span>
              <Input
                id="p-price"
                value={sellingPriceInput}
                onChange={(e) => setSellingPriceInput(e.target.value)}
                placeholder="0.00"
                required
                className="pl-14 font-mono font-medium"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="p-tax" className="text-xs font-semibold text-ace-navy">VAT Rate</Label>
            <Select value={taxRateId} onValueChange={setTaxRateId}>
              <SelectTrigger id="p-tax">
                <SelectValue placeholder="No VAT (zero-rated)" />
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

      {/* ── Section 4: Inventory Controls (Only for Inventory items) ── */}
      {productType === 'inventory' && (
        <div className="rounded-xl border bg-white p-5 shadow-xs space-y-4">
          <h2 className="font-semibold text-base text-ace-navy">Inventory Controls</h2>

          {!isEditing && (
            <div className="space-y-4 pb-4 border-b">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="p-initial-qty" className="text-xs font-semibold text-ace-navy">
                    Initial Quantity on Hand
                  </Label>
                  <Input
                    id="p-initial-qty"
                    type="number"
                    min="0"
                    step="any"
                    value={initialQuantity}
                    onChange={(e) => setInitialQuantity(e.target.value)}
                    placeholder="0"
                  />
                </div>

                {locations.length > 0 && (
                  <div className="space-y-1">
                    <Label htmlFor="p-initial-loc" className="text-xs font-semibold text-ace-navy">
                      Stock Location
                    </Label>
                    <Select value={initialLocationId} onValueChange={setInitialLocationId}>
                      <SelectTrigger id="p-initial-loc">
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
                )}
              </div>

              {parseFloat(initialQuantity || '0') > 0 && (
                <div className="space-y-1">
                  <Label htmlFor="p-initial-cost" className="text-xs font-semibold text-ace-navy">
                    Initial Unit Cost (MWK, optional)
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs font-bold text-ace-muted">MWK</span>
                    <Input
                      id="p-initial-cost"
                      value={initialCostInput}
                      onChange={(e) => setInitialCostInput(e.target.value)}
                      placeholder="0.00"
                      className="pl-14 font-mono font-medium"
                    />
                  </div>
                </div>
              )}

              {serialTracking && parseFloat(initialQuantity || '0') > 0 && (
                <div className="space-y-1">
                  <Label htmlFor="p-initial-serials" className="text-xs font-semibold text-ace-navy">
                    Serial Numbers ({Math.floor(parseFloat(initialQuantity || '0'))} required, comma or line separated)
                  </Label>
                  <Textarea
                    id="p-initial-serials"
                    value={initialSerials}
                    onChange={(e) => setInitialSerials(e.target.value)}
                    placeholder="SN001, SN002, SN003..."
                    rows={2}
                    className="text-xs font-mono"
                  />
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="p-minstock" className="text-xs font-semibold text-ace-navy">
                Low Stock Alert Level
              </Label>
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

            <div className="space-y-1">
              <Label htmlFor="p-maxstock" className="text-xs font-semibold text-ace-navy">
                Max Stock Level
              </Label>
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

          <div className="flex items-center justify-between rounded-lg border p-3.5 bg-gray-50/50">
            <Label htmlFor="p-serial" className="text-sm font-semibold text-ace-navy cursor-pointer">
              Serial Number Tracking
            </Label>
            <Switch
              id="p-serial"
              checked={serialTracking}
              onCheckedChange={setSerialTracking}
            />
          </div>
        </div>
      )}

      {/* ── Section 5: Bundle Components (Only for Bundle items) ── */}
      {productType === 'bundle' && (
        <div className="rounded-xl border bg-white p-5 shadow-xs space-y-4">
          <h2 className="font-semibold text-base text-ace-navy">Bundle Components</h2>

          <div className="space-y-2.5">
            {bundleLines.map((line, i) => (
              <div key={i} className="flex items-center gap-3 bg-gray-50 p-2.5 rounded-lg border">
                <div className="flex-1 space-y-1">
                  <Select
                    value={line.componentProductId}
                    onValueChange={(v) => updateBundleLine(i, 'componentProductId', v)}
                  >
                    <SelectTrigger className="bg-white" id={`bundle-comp-${i}`}>
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleComponents.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-24 space-y-1">
                  <Input
                    className="bg-white font-mono"
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={line.quantity}
                    onChange={(e) => updateBundleLine(i, 'quantity', e.target.value)}
                    id={`bundle-qty-${i}`}
                    placeholder="Qty"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeBundleLine(i)}
                  disabled={bundleLines.length <= 1}
                  className="text-red-500 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={addBundleLine}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Component
            </Button>
          </div>
        </div>
      )}

      {/* ── Section 6: Status ── */}
      <div className="rounded-xl border bg-white p-4 shadow-xs">
        <div className="flex items-center justify-between">
          <Label htmlFor="p-active" className="text-sm font-semibold text-ace-navy cursor-pointer">
            Product Active
          </Label>
          <Switch id="p-active" checked={isActive} onCheckedChange={setIsActive} />
        </div>
      </div>

      {/* ── Form Actions ── */}
      <div className="flex items-center gap-3 pt-1">
        <Button
          type="submit"
          disabled={isPending}
          id="save-product-btn"
          className="bg-ace-blue hover:bg-ace-navy text-white px-6 font-semibold shadow-xs"
        >
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

      {/* Inline Creation Popups */}
      <UomDialog
        open={isUomDialogOpen}
        onOpenChange={setIsUomDialogOpen}
        onSuccess={(created) => {
          setUomsList((prev) => {
            if (prev.some((u) => u.id === created.id)) return prev;
            return [...prev, created].sort((a, b) => a.name.localeCompare(b.name));
          });
          setUomId(created.id);
        }}
      />

      <CategoryDialog
        open={isCatDialogOpen}
        onOpenChange={setIsCatDialogOpen}
        onSuccess={(created) => {
          setCategoriesList((prev) => {
            if (prev.some((c) => c.id === created.id)) return prev;
            return [...prev, { id: created.id, name: created.name }].sort((a, b) => a.name.localeCompare(b.name));
          });
          setCategoryId(created.id);
        }}
      />
    </form>
  );
}