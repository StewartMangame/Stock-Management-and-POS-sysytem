'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Barcode,
  Search,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  PauseCircle,
  PlayCircle,
  FileText,
  DollarSign,
  Lock,
  ArrowLeftRight,
  Wifi,
  Package,
  Layers,
  Sparkles,
  RotateCcw,
  AlertTriangle,
  MoreHorizontal,
  ArrowLeft,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatMwk, parseKwachaToMinor } from '@/lib/money';
import {
  openShiftAction,
  createCounterSaleAction,
  holdSaleAction,
  listHeldSalesAction,
} from '@/app/(app)/pos/actions';
import { PaymentModal, type PaymentLeg } from './PaymentModal';
import { PostSaleModal } from './PostSaleModal';
import { ManagerOverrideModal } from './ManagerOverrideModal';
import { CashMovementModal } from './CashMovementModal';
import { HeldSalesModal } from './HeldSalesModal';
import { XReportModal } from './XReportModal';
import { CloseShiftModal } from './CloseShiftModal';
import { ZReportModal } from './ZReportModal';
import Link from 'next/link';
import { toast } from 'sonner';

export interface CartItem {
  id: string; // unique item entry id
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  basePriceMinor: number;
  unitPriceMinor: number;
  quantity: number;
  taxRateBasisPoints: number;
  taxRateName: string;
  availableQty: number;
  isSerialTracked: boolean;
  serialNumbers?: string[];
  discountMinor: number;
  overrideApproverId?: string;
  overridePin?: string;
  overrideReason?: string;
}

interface POSClientProps {
  initialShift: any | null;
  locations: Array<{ id: string; name: string; code: string }>;
  currentUser: { id: string; name: string; roleName: string };
}

export function POSClient({ initialShift, locations, currentUser }: POSClientProps) {
  const [shift, setShift] = useState(initialShift);
  const [products, setProducts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  // Cart State (hydrated after mount to prevent SSR hydration mismatch)
  const [cart, setCart] = useState<CartItem[]>([]);
  const [hasMounted, setHasMounted] = useState(false);
  const [heldCount, setHeldCount] = useState(0);

  // Restore cart from sessionStorage on client mount
  useEffect(() => {
    setHasMounted(true);
    try {
      const saved = sessionStorage.getItem('ace_pos_cart');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setCart(parsed);
        }
      }
    } catch {}
  }, []);

  // Sync cart to sessionStorage once mounted
  useEffect(() => {
    if (!hasMounted) return;
    try {
      if (cart.length > 0) {
        sessionStorage.setItem('ace_pos_cart', JSON.stringify(cart));
      } else {
        sessionStorage.removeItem('ace_pos_cart');
      }
    } catch {}
  }, [cart, hasMounted]);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [mobileTab, setMobileTab] = useState<'catalog' | 'cart'>('catalog');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Modals state
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isPostSaleOpen, setIsPostSaleOpen] = useState(false);
  const [postSaleResult, setPostSaleResult] = useState<any>(null);
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);
  const [overrideContext, setOverrideContext] = useState<any>(null);
  const [isCashMovementOpen, setIsCashMovementOpen] = useState(false);
  const [isHeldModalOpen, setIsHeldModalOpen] = useState(false);
  const [isXReportOpen, setIsXReportOpen] = useState(false);
  const [isCloseShiftOpen, setIsCloseShiftOpen] = useState(false);
  const [isZReportOpen, setIsZReportOpen] = useState(false);
  const [closedShiftId, setClosedShiftId] = useState<string | null>(null);

  // Open Shift Form State
  const [openLocationId, setOpenLocationId] = useState(locations[0]?.id || '');
  const [openFloatStr, setOpenFloatStr] = useState('0');
  const [openShiftLoading, setOpenShiftLoading] = useState(false);

  // Load products catalog and customers
  useEffect(() => {
    if (shift) {
      setLoadingCatalog(true);
      Promise.all([
        fetch(`/api/pos/products?locationId=${shift.locationId}`).then((r) => r.json()),
        fetch('/api/pos/customers').then((r) => r.json()),
        listHeldSalesAction(shift.id),
      ])
        .then(([prodData, custData, heldData]) => {
          if (prodData.products) setProducts(prodData.products);
          if (custData.customers) {
            setCustomers(custData.customers);
            setSelectedCustomerId(custData.defaultCustomerId || custData.customers[0]?.id || '');
          }
          if (Array.isArray(heldData)) setHeldCount(heldData.length);
        })
        .catch(() => toast.error('Failed to load POS catalog'))
        .finally(() => setLoadingCatalog(false));
    }
  }, [shift]);

  // Global hotkeys (F4 for pay, F2 for search)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F4') {
        e.preventDefault();
        if (cart.length > 0 && !isPaymentOpen) {
          setIsPaymentOpen(true);
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, isPaymentOpen]);

  // Handle Open Shift
  const handleOpenShiftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let floatMinor = 0;
    try {
      floatMinor = parseKwachaToMinor(openFloatStr);
      if (floatMinor < 0) throw new Error();
    } catch {
      toast.error('Please enter a valid opening float amount');
      return;
    }

    setOpenShiftLoading(true);
    try {
      const res = await openShiftAction({
        locationId: openLocationId,
        openingFloatMinor: floatMinor,
      });
      setShift(res.shift);
      toast.success(`Shift ${res.shift.shiftNumber} opened successfully`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to open shift');
    } finally {
      setOpenShiftLoading(false);
    }
  };

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.categoryName) set.add(p.categoryName);
    });
    return Array.from(set);
  }, [products]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return products.filter((p) => {
      const matchesCategory =
        selectedCategory === 'all' || p.categoryName === selectedCategory;
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q));
      return matchesCategory && matchesSearch;
    });
  }, [products, searchQuery, selectedCategory]);

  // Add Product to Cart
  const handleAddToCart = (product: any) => {
    if (product.availableQty <= 0) {
      toast.error(`${product.name} is out of stock!`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        if (existing.quantity >= product.availableQty) {
          toast.warning(`Maximum available stock reached (${product.availableQty})`);
          return prev;
        }
        return prev.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }

      const newItem: CartItem = {
        id: Math.random().toString(),
        productId: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        basePriceMinor: Number(product.sellingPriceMinor),
        unitPriceMinor: Number(product.sellingPriceMinor),
        quantity: 1,
        taxRateBasisPoints: product.taxRateBasisPoints,
        taxRateName: product.taxRateName,
        availableQty: product.availableQty,
        isSerialTracked: product.isSerialTracked,
        discountMinor: 0,
      };
      return [...prev, newItem];
    });

    // Auto-clear search if it was an exact barcode scan
    if (searchQuery && product.barcode === searchQuery.trim()) {
      setSearchQuery('');
    }
  };

  // Update Cart Item Quantity
  const handleUpdateQty = (itemId: string, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveItem(itemId);
      return;
    }
    setCart((prev) =>
      prev.map((item) => {
        if (item.id === itemId) {
          if (newQty > item.availableQty) {
            toast.warning(`Only ${item.availableQty} available in stock`);
            return { ...item, quantity: item.availableQty };
          }
          return { ...item, quantity: newQty };
        }
        return item;
      }),
    );
  };

  const handleRemoveItem = (itemId: string) => {
    setCart((prev) => prev.filter((item) => item.id !== itemId));
  };

  // Trigger price override modal
  const handleRequestPriceEdit = (item: CartItem) => {
    setOverrideContext({
      type: 'price_override',
      item,
    });
    setIsOverrideOpen(true);
  };

  const handleOverrideSuccess = (approverId: string, pin: string, reason: string) => {
    if (overrideContext?.type === 'price_override') {
      const { item } = overrideContext;
      const newPriceStr = prompt(
        `Enter approved selling price for ${item.name} in MWK:`,
        (item.unitPriceMinor / 100).toFixed(2),
      );
      if (!newPriceStr) return;

      try {
        const approvedPriceMinor = parseKwachaToMinor(newPriceStr);
        setCart((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  unitPriceMinor: approvedPriceMinor,
                  discountMinor: Math.max(0, i.basePriceMinor - approvedPriceMinor),
                  overrideApproverId: approverId,
                  overridePin: pin,
                  overrideReason: reason,
                }
              : i,
          ),
        );
        toast.success('Price override applied');
      } catch {
        toast.error('Invalid price entered');
      }
    }
  };

  // Cart Financial Totals
  const { subtotalMinor, taxMinor, discountMinor, grandTotalMinor } = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    let discount = 0;

    cart.forEach((item) => {
      const lineNet = item.unitPriceMinor * item.quantity;
      subtotal += lineNet;
      discount += (item.discountMinor || 0) * item.quantity;
      const lineTax = Math.round((lineNet * item.taxRateBasisPoints) / 10000);
      tax += lineTax;
    });

    const grandTotal = subtotal + tax;
    return {
      subtotalMinor: subtotal,
      taxMinor: tax,
      discountMinor: discount,
      grandTotalMinor: grandTotal,
    };
  }, [cart]);

  // Hold Sale
  const handleHoldSale = async () => {
    if (cart.length === 0) return;
    const ref = prompt('Enter a reference label for this hold (e.g. Customer Name / Car):');
    if (!ref || !ref.trim()) return;

    try {
      await holdSaleAction({
        shiftId: shift.id,
        holdReference: ref.trim(),
        customerId: selectedCustomerId || undefined,
        cartPayload: {
          lines: cart.map((c) => ({
            productId: c.productId,
            quantity: c.quantity,
            unitPriceMinor: c.unitPriceMinor,
            discountMinor: c.discountMinor,
            serialNumbers: c.serialNumbers,
          })),
        },
      });

      setCart([]);
      setMobileTab('catalog');
      setHeldCount((prev) => prev + 1);
      toast.success(`Sale held under reference "${ref.trim()}"`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to hold sale');
    }
  };

  // Recall Sale from Hold
  const handleRecalledCart = (recalledData: any) => {
    const restored: CartItem[] = recalledData.lines.map((l: any) => {
      const prod = products.find((p) => p.id === l.productId);
      return {
        id: Math.random().toString(),
        productId: l.productId,
        name: l.productName,
        sku: l.sku,
        barcode: prod?.barcode ?? null,
        basePriceMinor: l.currentUnitPriceMinor,
        unitPriceMinor: l.currentUnitPriceMinor,
        quantity: l.quantity,
        taxRateBasisPoints: prod?.taxRateBasisPoints ?? 0,
        taxRateName: prod?.taxRateName ?? '',
        availableQty: l.availableQty,
        isSerialTracked: prod?.isSerialTracked ?? false,
        discountMinor: 0,
      };
    });

    setCart(restored);
    setHeldCount((prev) => Math.max(0, prev - 1));
  };

  // Complete Sale
  const handleCompleteSale = async (payments: PaymentLeg[], changeMinor: number) => {
    // Collect any override PIN used on cart lines
    const lineWithOverride = cart.find((c) => c.overridePin && c.overrideReason);
    const managerOverride = lineWithOverride
      ? {
          pin: lineWithOverride.overridePin!,
          reason: lineWithOverride.overrideReason!,
        }
      : undefined;

    // Generate unique idempotency key for double-tap protection
    const idempotencyKey = `pos:${shift.id}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;

    const res = await createCounterSaleAction({
      idempotencyKey,
      shiftId: shift.id,
      locationId: shift.locationId,
      cashierId: currentUser.id,
      customerId: selectedCustomerId || undefined,
      clientCreatedAt: new Date().toISOString(),
      managerOverride,
      lines: cart.map((c) => ({
        productId: c.productId,
        quantity: c.quantity,
        overriddenPriceMinor:
          c.unitPriceMinor !== c.basePriceMinor ? c.unitPriceMinor : undefined,
        discountMinor: c.discountMinor,
        serialNumbers: c.serialNumbers,
      })),
      payments: payments.map((p) => ({
        method: p.method,
        appliedMinor: p.appliedMinor,
        tenderedMinor: p.tenderedMinor,
        methodDetails: p.details,
        existingPaymentId: p.existingPaymentId,
      })),
    });

    setPostSaleResult({
      invoiceId: res.sale.id,
      invoiceNumber: res.sale.documentNumber,
      totalMinor: grandTotalMinor,
      changeMinor,
    });
    setIsPostSaleOpen(true);
    setCart([]);
    setMobileTab('catalog');
  };

  // ==========================================
  // VIEW A: If No Open Shift, Show Open Shift
  // ==========================================
  if (!shift) {
    return (
      <div className="flex h-full min-h-[80vh] items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-xl border-border">
          <CardContent className="pt-6 space-y-6">
            <div className="text-center space-y-2">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ace-navy text-white shadow-lg">
                <ShoppingCart className="h-7 w-7 text-ace-cyan" />
              </div>
              <h1 className="text-2xl font-bold text-ace-navy">Open POS Register</h1>
              <p className="text-xs text-muted-foreground">
                Hello, {currentUser.name}. Please select your location and enter your opening float to start your shift.
              </p>
            </div>

            <form onSubmit={handleOpenShiftSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="open-loc" className="text-xs font-semibold">
                  Register Location
                </Label>
                <Select value={openLocationId} onValueChange={setOpenLocationId}>
                  <SelectTrigger id="open-loc" className="h-10 text-sm">
                    <SelectValue placeholder="Select register location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name} ({loc.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="open-float" className="text-xs font-semibold">
                  Opening Float (MWK)
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs font-bold text-muted-foreground">
                    MWK
                  </span>
                  <Input
                    id="open-float"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0.00"
                    autoFocus
                    value={openFloatStr}
                    onChange={(e) => setOpenFloatStr(e.target.value)}
                    className="pl-14 text-base font-semibold"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={openShiftLoading}
                className="w-full bg-ace-navy hover:bg-ace-navy-deep text-white font-bold h-11 shadow-md"
              >
                {openShiftLoading ? 'Opening Shift...' : 'Open Shift & Start Selling'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ==========================================
  // VIEW B: Live Counter POS Screen
  // ==========================================
  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] -m-3 sm:-m-4 md:-m-6 overflow-hidden bg-background">
      {/* ── TOP ACTION BAR ────────────────────────────────────────────────── */}
      <header className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 px-3 sm:px-4 md:px-6 py-2 sm:py-2.5 border-b border-border bg-card shadow-xs shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="font-extrabold text-xs sm:text-sm tracking-tight text-ace-navy">ACE POS</span>
            <Badge variant="outline" className="border-ace-blue bg-ace-band/40 text-ace-navy font-bold text-[10px] sm:text-xs">
              #{shift.shiftNumber}
            </Badge>
          </div>
          <span className="text-muted-foreground hidden sm:inline">•</span>
          <span className="text-[11px] sm:text-xs font-medium text-muted-foreground truncate max-w-[120px] sm:max-w-none">
            {shift.locationName}
          </span>
          <span className="text-muted-foreground hidden md:inline">•</span>
          <span className="text-[11px] sm:text-xs font-medium text-muted-foreground hidden md:inline">
            Cashier: <strong className="text-foreground">{currentUser.name}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Held Sales Button */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsHeldModalOpen(true)}
            className="h-8 text-xs font-semibold relative px-2.5"
          >
            <PauseCircle className="sm:mr-1.5 h-3.5 w-3.5 text-amber-600" />
            <span className="hidden sm:inline">Held</span>
            {heldCount > 0 && (
              <span className="ml-1 sm:ml-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                {heldCount}
              </span>
            )}
          </Button>

          {/* Desktop utility buttons */}
          <div className="hidden lg:flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsCashMovementOpen(true)}
              className="h-8 text-xs font-semibold"
            >
              <DollarSign className="mr-1.5 h-3.5 w-3.5 text-ace-blue" />
              Cash In/Out
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsXReportOpen(true)}
              className="h-8 text-xs font-semibold"
            >
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              X-Report
            </Button>
            <Link href="/pos/returns">
              <Button size="sm" variant="outline" className="h-8 text-xs font-semibold">
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Returns
              </Button>
            </Link>
          </div>

          {/* Mobile / Tablet More Actions Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 w-8 p-0 lg:hidden" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setIsCashMovementOpen(true)}>
                <DollarSign className="mr-2 h-4 w-4 text-ace-blue" />
                Cash In/Out
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsXReportOpen(true)}>
                <FileText className="mr-2 h-4 w-4" />
                X-Report
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/pos/returns">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Counter Returns
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Close Shift */}
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setIsCloseShiftOpen(true)}
            className="h-8 text-xs font-bold px-2.5 sm:px-3"
          >
            <Lock className="sm:mr-1.5 h-3.5 w-3.5" />
            <span className="hidden sm:inline">Close Shift</span>
            <span className="sm:hidden">Close</span>
          </Button>
        </div>
      </header>

      {/* ── MOBILE / TABLET TAB SWITCHER ───────────────────────────────── */}
      <div className="flex border-b border-border bg-card lg:hidden shrink-0">
        <button
          type="button"
          onClick={() => setMobileTab('catalog')}
          className={`flex-1 py-2 text-xs font-bold border-b-2 transition-colors flex items-center justify-center gap-1.5 ${
            mobileTab === 'catalog'
              ? 'border-ace-navy text-ace-navy bg-ace-band/20'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Package className="h-3.5 w-3.5" />
          Catalog ({filteredProducts.length})
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('cart')}
          className={`flex-1 py-2 text-xs font-bold border-b-2 transition-colors flex items-center justify-center gap-1.5 ${
            mobileTab === 'cart'
              ? 'border-ace-navy text-ace-navy bg-ace-band/20'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          Cart ({cart.reduce((s, c) => s + c.quantity, 0)})
          {grandTotalMinor > 0 && (
            <span className="font-mono text-ace-blue font-bold">
              • {formatMwk(grandTotalMinor)}
            </span>
          )}
        </button>
      </div>

      {/* ── MAIN WORKSPACE: LEFT CATALOG + RIGHT CART ─────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* LEFT: Product Catalog */}
        <section
          className={`flex-col flex-1 border-r border-border overflow-hidden bg-muted/10 ${
            mobileTab === 'cart' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {/* Search & Barcode Input */}
          <div className="p-3 sm:p-4 border-b border-border bg-card space-y-2.5 sm:space-y-3 shrink-0">
            <div className="relative">
              <Barcode className="absolute left-3.5 top-2.5 h-5 w-5 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder="Scan barcode or search products by SKU / name... (F2)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-11 h-10 text-xs sm:text-sm font-medium bg-background"
              />
            </div>

            {/* Category Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-all ${
                  selectedCategory === 'all'
                    ? 'bg-ace-navy text-white shadow-xs'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                }`}
              >
                All Items ({products.length})
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-all ${
                    selectedCategory === cat
                      ? 'bg-ace-navy text-white shadow-xs'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Product Grid */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4">
            {loadingCatalog ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                Loading products catalog...
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground space-y-2">
                <Package className="h-10 w-10 text-muted-foreground/50" />
                <p className="text-sm font-medium">No products matching your search</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
                {filteredProducts.map((p) => {
                  const outOfStock = p.availableQty <= 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={outOfStock}
                      onClick={() => handleAddToCart(p)}
                      className={`flex flex-col justify-between text-left p-2.5 sm:p-3.5 rounded-xl border transition-all duration-150 ${
                        outOfStock
                          ? 'opacity-50 cursor-not-allowed bg-muted/40 border-dashed border-border'
                          : 'bg-card hover:border-ace-sky hover:shadow-md cursor-pointer border-border'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] sm:text-[11px] font-mono font-bold text-muted-foreground truncate">
                            {p.sku}
                          </span>
                          {p.isSerialTracked && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1 py-0 border-ace-sky text-ace-navy font-semibold">
                              SN
                            </Badge>
                          )}
                          {p.isBundle && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1 py-0 border-amber-500 text-amber-700 font-semibold">
                              Bundle
                            </Badge>
                          )}
                        </div>
                        <h4 className="font-semibold text-xs text-foreground line-clamp-2 leading-snug">
                          {p.name}
                        </h4>
                      </div>

                      <div className="mt-2.5 sm:mt-3 pt-2 border-t border-border/60 flex items-center justify-between gap-1">
                        <span className="font-bold text-xs sm:text-sm text-ace-navy truncate">
                          {formatMwk(p.sellingPriceMinor)}
                        </span>
                        <span
                          className={`text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                            outOfStock
                              ? 'bg-destructive/10 text-destructive'
                              : p.availableQty <= 5
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {outOfStock ? 'Out' : `${p.availableQty}`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sticky Mobile Cart Checkout Bar */}
          {cart.length > 0 && (
            <div className="p-3 border-t border-border bg-card shadow-lg lg:hidden flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-muted-foreground uppercase block truncate">
                  {cart.reduce((s, c) => s + c.quantity, 0)} items in cart
                </span>
                <span className="text-sm font-black text-ace-navy block truncate">
                  {formatMwk(grandTotalMinor)}
                </span>
              </div>
              <Button
                type="button"
                onClick={() => setMobileTab('cart')}
                className="bg-ace-navy hover:bg-ace-navy-deep text-white font-bold h-9 px-3.5 text-xs shadow-sm flex items-center gap-1.5 shrink-0"
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                View Cart & Pay →
              </Button>
            </div>
          )}
        </section>

        {/* RIGHT: Cart & Tender Panel */}
        <section
          className={`flex-col w-full lg:w-[380px] xl:w-[440px] shrink-0 bg-card overflow-hidden ${
            mobileTab === 'catalog' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {/* Mobile Back To Catalog */}
          <div className="p-2.5 border-b border-border bg-muted/10 flex items-center justify-between lg:hidden shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMobileTab('catalog')}
              className="h-8 text-xs font-semibold text-ace-navy"
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back to Catalog
            </Button>
            <span className="text-xs font-bold text-muted-foreground">
              {cart.reduce((s, c) => s + c.quantity, 0)} Items
            </span>
          </div>

          {/* Customer Selector */}
          <div className="p-3 sm:p-3.5 border-b border-border bg-muted/20 shrink-0">
            <div className="flex items-center justify-between mb-1">
              <Label className="text-[11px] font-bold text-muted-foreground uppercase">
                Customer Account
              </Label>
              <Badge variant="secondary" className="text-[10px] font-semibold">
                Default: Walk-in
              </Badge>
            </div>
            <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
              <SelectTrigger className="h-9 text-xs bg-background">
                <SelectValue placeholder="Select Customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.name} {c.isWalkIn ? '(Walk-In Cash)' : `[${c.accountNumber}]`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground space-y-2 py-12">
                <ShoppingCart className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-xs font-semibold">Cart is currently empty</p>
                <p className="text-[11px]">Scan an item or click a product to begin</p>
              </div>
            ) : (
              cart.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-border p-2.5 bg-background shadow-2xs space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h5 className="font-semibold text-xs text-foreground line-clamp-1">
                        {item.name}
                      </h5>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {item.sku}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveItem(item.id)}
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    {/* Quantity Selector */}
                    <div className="flex items-center gap-1 border border-border rounded-md bg-muted/40 p-0.5">
                      <button
                        type="button"
                        onClick={() => handleUpdateQty(item.id, item.quantity - 1)}
                        className="h-6 w-6 flex items-center justify-center rounded hover:bg-background text-muted-foreground"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <input
                        type="number"
                        min="1"
                        max={item.availableQty}
                        value={item.quantity}
                        onChange={(e) =>
                          handleUpdateQty(item.id, parseInt(e.target.value) || 1)
                        }
                        className="w-10 text-center font-bold text-xs bg-transparent focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleUpdateQty(item.id, item.quantity + 1)}
                        className="h-6 w-6 flex items-center justify-center rounded hover:bg-background text-muted-foreground"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Price and Override */}
                    <div className="text-right">
                      <button
                        type="button"
                        onClick={() => handleRequestPriceEdit(item)}
                        className="text-xs font-bold text-ace-navy hover:underline flex items-center gap-1 ml-auto"
                        title="Click to request manager price override"
                      >
                        {formatMwk(item.unitPriceMinor * item.quantity)}
                      </button>
                      {item.unitPriceMinor !== item.basePriceMinor && (
                        <span className="text-[10px] text-amber-700 font-semibold block">
                          Overridden (Orig: {formatMwk(item.basePriceMinor)})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Cart Totals & Checkout Actions */}
          <div className="p-4 border-t border-border bg-card space-y-3 shadow-lg">
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal (Net)</span>
                <span>{formatMwk(subtotalMinor)}</span>
              </div>
              {discountMinor > 0 && (
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>Discounts</span>
                  <span>-{formatMwk(discountMinor)}</span>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>VAT / Tax</span>
                <span>{formatMwk(taxMinor)}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-border">
                <span className="font-extrabold text-sm text-foreground">Total Due:</span>
                <span className="font-black text-2xl text-ace-navy">
                  {formatMwk(grandTotalMinor)}
                </span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={cart.length === 0}
                onClick={handleHoldSale}
                className="h-9 text-xs font-semibold"
              >
                <PauseCircle className="mr-1.5 h-3.5 w-3.5 text-amber-600" />
                Hold Cart
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={cart.length === 0}
                onClick={() => {
                  setCart([]);
                  setMobileTab('catalog');
                }}
                className="h-9 text-xs font-semibold text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Clear
              </Button>
            </div>

            {/* Pay Button */}
            <Button
              type="button"
              disabled={cart.length === 0}
              onClick={() => setIsPaymentOpen(true)}
              className="w-full bg-ace-navy hover:bg-ace-navy-deep text-white font-extrabold h-13 text-base shadow-md tracking-wide"
            >
              PAY (F4) — {formatMwk(grandTotalMinor)}
            </Button>
          </div>
        </section>
      </div>

      {/* ── MODALS ───────────────────────────────────────────────────────── */}
      <PaymentModal
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        totalMinor={grandTotalMinor}
        onCompleteSale={handleCompleteSale}
        shiftId={shift?.id}
        locationId={shift?.locationId}
        customerId={selectedCustomerId || undefined}
      />

      <PostSaleModal
        isOpen={isPostSaleOpen}
        onClose={() => setIsPostSaleOpen(false)}
        saleResult={postSaleResult}
        onNextCustomer={() => {
          setIsPostSaleOpen(false);
          setPostSaleResult(null);
          searchInputRef.current?.focus();
        }}
      />

      <ManagerOverrideModal
        isOpen={isOverrideOpen}
        onClose={() => {
          setIsOverrideOpen(false);
          setOverrideContext(null);
        }}
        action="pos:price_override"
        actionLabel="Authorize Line Price Discount"
        onSuccess={handleOverrideSuccess}
      />

      <CashMovementModal
        isOpen={isCashMovementOpen}
        onClose={() => setIsCashMovementOpen(false)}
        shiftId={shift.id}
      />

      <HeldSalesModal
        isOpen={isHeldModalOpen}
        onClose={() => setIsHeldModalOpen(false)}
        shiftId={shift.id}
        onRecallCart={handleRecalledCart}
      />

      <XReportModal
        isOpen={isXReportOpen}
        onClose={() => setIsXReportOpen(false)}
        shiftId={shift.id}
      />

      <CloseShiftModal
        isOpen={isCloseShiftOpen}
        onClose={() => setIsCloseShiftOpen(false)}
        shiftId={shift.id}
        onShiftClosed={(sId) => {
          setClosedShiftId(sId);
          setShift(null);
          setIsZReportOpen(true);
        }}
      />

      {closedShiftId && (
        <ZReportModal
          isOpen={isZReportOpen}
          onClose={() => {
            setIsZReportOpen(false);
            setClosedShiftId(null);
          }}
          shiftId={closedShiftId}
        />
      )}
    </div>
  );
}
