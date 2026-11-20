'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Truck,
  CreditCard,
  BarChart3,
  Settings,
  Monitor,
  ChevronDown,
  ChevronRight,
  Wallet,
  ClipboardList,
  ShieldCheck,
  BookOpen,
  History,
} from 'lucide-react';
import { useState } from 'react';
import { PERMISSIONS } from '@/lib/permissions';

interface NavChild {
  label: string;
  href: string;
  permission?: string; // optional – if set, hidden unless user has this permission
}

interface NavItem {
  label: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: NavChild[];
  permission?: string; // top-level permission gate
}

// ── Static nav definition ────────────────────────────────────────────────────
// Children with no `permission` are always shown when the parent is visible.
const NAV_GROUPS: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    label: 'Sales',
    icon: ShoppingCart,
    permission: PERMISSIONS.INVOICES_VIEW,
    children: [
      { label: 'Customers', href: '/sales/customers', permission: PERMISSIONS.CUSTOMERS_VIEW },
      { label: 'Quotations', href: '/sales/quotations', permission: PERMISSIONS.QUOTATIONS_VIEW },
      { label: 'Invoices', href: '/sales/invoices', permission: PERMISSIONS.INVOICES_VIEW },
      { label: 'Delivery Notes', href: '/sales/delivery-notes', permission: PERMISSIONS.DELIVERY_NOTES_MANAGE },
      { label: 'Credit Notes', href: '/sales/credit-notes', permission: PERMISSIONS.CREDIT_NOTES_MANAGE },
      { label: 'Payments', href: '/sales/payments', permission: PERMISSIONS.PAYMENTS_VIEW },
    ],
  },
  {
    label: 'Stock',
    icon: Package,
    permission: PERMISSIONS.STOCK_VIEW,
    children: [
      { label: 'Products', href: '/stock/products', permission: PERMISSIONS.PRODUCTS_VIEW },
      { label: 'Stock On Hand', href: '/stock/on-hand', permission: PERMISSIONS.STOCK_VIEW },
      { label: 'Stock Ledger', href: '/stock/movements', permission: PERMISSIONS.STOCK_VIEW },
      { label: 'Adjustments', href: '/stock/adjustments', permission: PERMISSIONS.STOCK_ADJUST },
      { label: 'Stock Counts', href: '/stock/counts', permission: PERMISSIONS.STOCK_COUNT },
      { label: 'Serial Numbers', href: '/stock/serials', permission: PERMISSIONS.SERIALS_VIEW },
      { label: 'Categories', href: '/stock/categories', permission: PERMISSIONS.PRODUCTS_MANAGE },
      { label: 'Import CSV', href: '/stock/products/import', permission: PERMISSIONS.PRODUCTS_MANAGE },
    ],
  },
  {
    label: 'Purchasing',
    icon: Truck,
    permission: PERMISSIONS.PURCHASE_ORDERS_VIEW,
    children: [
      { label: 'Suppliers', href: '/purchasing/suppliers', permission: PERMISSIONS.SUPPLIERS_VIEW },
      { label: 'Purchase Orders', href: '/purchasing/orders', permission: PERMISSIONS.PURCHASE_ORDERS_VIEW },
      { label: 'Goods Received', href: '/purchasing/receipts', permission: PERMISSIONS.GOODS_RECEIPTS_MANAGE },
    ],
  },
  {
    label: 'Counter POS',
    href: '/pos',
    icon: Monitor,
    permission: PERMISSIONS.POS_ACCESS,
  },
  {
    label: 'Payments',
    href: '/payments',
    icon: CreditCard,
    permission: PERMISSIONS.PAYMENTS_VIEW,
  },
  {
    label: 'Reports',
    icon: BarChart3,
    permission: PERMISSIONS.REPORTS_VIEW,
    children: [
      { label: 'Reports Centre', href: '/reports' },
      { label: 'Sales', href: '/reports/sales', permission: PERMISSIONS.REPORTS_VIEW },
      { label: 'Profit', href: '/reports/profit', permission: PERMISSIONS.REPORTS_COST },
      { label: 'VAT Summary', href: '/reports/vat', permission: PERMISSIONS.REPORTS_COST },
      { label: 'Stock', href: '/reports/stock', permission: PERMISSIONS.STOCK_VIEW },
      { label: 'Purchasing', href: '/reports/purchasing', permission: PERMISSIONS.PURCHASE_ORDERS_VIEW },
      { label: 'Warranty', href: '/reports/warranty', permission: PERMISSIONS.REPORTS_VIEW },
      { label: 'Pipeline', href: '/reports/pipeline', permission: PERMISSIONS.REPORTS_VIEW },
      { label: 'Receivables', href: '/reports/aged-debtors', permission: PERMISSIONS.REPORTS_VIEW },
      { label: 'Payments Received', href: '/reports/payments-received', permission: PERMISSIONS.PAYMENTS_VIEW },
      { label: 'Customer Statement', href: '/reports/customer-statement', permission: PERMISSIONS.REPORTS_VIEW },
      { label: 'Controls', href: '/reports/controls', permission: PERMISSIONS.REPORTS_COST },
      { label: 'POS Shifts', href: '/reports/shifts', permission: PERMISSIONS.SHIFTS_MANAGE },
    ],
  },
  {
    label: 'Accounting',
    href: '/accounting/batches',
    icon: BookOpen,
    permission: PERMISSIONS.ACCOUNTING_VIEW,
  },
  {
    label: 'Settings',
    icon: Settings,
    permission: PERMISSIONS.SETTINGS_VIEW,
    children: [
      { label: 'Users', href: '/admin/users', permission: PERMISSIONS.USERS_VIEW },
      { label: 'App Settings', href: '/admin/settings', permission: PERMISSIONS.SETTINGS_MANAGE },
      { label: 'Locations', href: '/admin/locations', permission: PERMISSIONS.LOCATIONS_MANAGE },
      { label: 'Integrations', href: '/admin/integrations', permission: PERMISSIONS.SETTINGS_MANAGE },
      { label: 'Card Terminals', href: '/admin/card-terminals', permission: PERMISSIONS.PAYMENTS_RECONCILE },
      { label: 'Exceptions', href: '/admin/exceptions', permission: PERMISSIONS.PAYMENTS_EXCEPTIONS },
      { label: 'Audit Log', href: '/admin/audit-log', permission: PERMISSIONS.AUDIT_LOG_VIEW },
      { label: 'System Checks', href: '/admin/system-checks', permission: PERMISSIONS.SYSTEM_CHECKS_RUN },
    ],
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

function NavGroup({
  item,
  permissions,
  onNavigate,
}: {
  item: NavItem;
  permissions: string[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? '';

  // Filter visible children
  const visibleChildren = item.children?.filter(
    (c) => !c.permission || permissions.includes(c.permission),
  );

  const isChildActive = visibleChildren?.some(
    (c) => pathname === c.href || pathname.startsWith(c.href + '/'),
  );
  const [open, setOpen] = useState(isChildActive ?? false);

  // Top-level leaf link
  if (item.href) {
    const active = pathname === item.href || pathname.startsWith(item.href + '/');
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        className={cn(
          'flex min-h-[40px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          active
            ? 'bg-ace-band text-ace-blue'
            : 'text-ace-muted hover:bg-ace-band hover:text-ace-blue',
        )}
        id={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {item.label}
      </Link>
    );
  }

  if (!visibleChildren?.length) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex min-h-[40px] w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isChildActive
            ? 'text-ace-blue'
            : 'text-ace-navy hover:bg-ace-band hover:text-ace-blue',
        )}
        aria-expanded={open}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">{item.label}</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 opacity-60" />
        )}
      </button>

      {open && (
        <div className="ml-7 mt-1 flex flex-col gap-0.5 border-l border-ace-band pl-3">
          {visibleChildren.map((child) => {
            const active = pathname === child.href || pathname.startsWith(child.href + '/');
            return (
              <Link
                key={child.href}
                href={child.href}
                onClick={onNavigate}
                className={cn(
                  'flex min-h-[36px] items-center rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'bg-ace-band text-ace-blue'
                    : 'text-ace-muted hover:text-ace-blue hover:bg-ace-band',
                )}
                id={`nav-${child.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  permissions = [],
  onNavigate,
  className,
}: {
  permissions?: string[];
  onNavigate?: () => void;
  className?: string;
}) {
  // Filter top-level groups by permission
  const visibleGroups = NAV_GROUPS.filter(
    (item) => !item.permission || permissions.includes(item.permission),
  );

  return (
    <aside
      className={cn(
        'flex h-full w-56 shrink-0 flex-col border-r border-gray-200 bg-white',
        className,
      )}
    >
      {/* Logo area */}
      <div className="flex h-14 items-center justify-between border-b border-ace-band px-4">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
            <Image
              src="/brand/ace-logo.png"
              alt="Ace Holdings Logo"
              width={32}
              height={32}
              className="h-8 w-auto max-w-[32px] object-contain"
              priority
            />
          </div>
          <div className="leading-tight">
            <p className="text-xs font-bold text-ace-navy-deep">ACE HOLDINGS</p>
            <p className="text-[10px] text-ace-muted">POS System</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main Navigation">
        <div className="flex flex-col gap-0.5">
          {visibleGroups.map((item) => (
            <NavGroup
              key={item.label}
              item={item}
              permissions={permissions}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </nav>

      {/* Footer accent strip */}
      <div className="flex h-1.5 w-full shrink-0">
        <div className="flex-1 bg-ace-blue" />
        <div className="flex-1 bg-ace-sky" />
        <div className="flex-1 bg-ace-cyan" />
      </div>
    </aside>
  );
}
