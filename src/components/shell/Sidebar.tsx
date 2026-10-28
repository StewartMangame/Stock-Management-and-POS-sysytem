'use client';

import Link from 'next/link';
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
  Users,
  Monitor,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';

interface NavItem {
  label: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: { label: string; href: string }[];
  badge?: string;
}

const navGroups: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    label: 'Sales',
    icon: ShoppingCart,
    children: [
      { label: 'Customers', href: '/sales/customers' },
      { label: 'Quotations', href: '/sales/quotations' },
      { label: 'Invoices', href: '/sales/invoices' },
      { label: 'Delivery Notes', href: '/sales/delivery-notes' },
      { label: 'Credit Notes', href: '/sales/credit-notes' },
      { label: 'Payments', href: '/sales/payments' },
      { label: 'Aged Debtors', href: '/sales/aged-debtors' },
    ],
  },
  {
    label: 'Stock',
    icon: Package,
    children: [
      { label: 'Products', href: '/stock/products' },
      { label: 'Stock On Hand', href: '/stock/on-hand' },
      { label: 'Stock Ledger', href: '/stock/movements' },
      { label: 'Adjustments', href: '/stock/adjustments' },
      { label: 'Stock Counts', href: '/stock/counts' },
      { label: 'Serial Numbers', href: '/stock/serials' },
      { label: 'Categories', href: '/stock/categories' },
      { label: 'Units of Measure', href: '/stock/units' },
      { label: 'Import CSV', href: '/stock/products/import' },
    ],
  },
  {
    label: 'Purchasing',
    icon: Truck,
    children: [
      { label: 'Suppliers', href: '/purchasing/suppliers' },
      { label: 'Purchase Orders', href: '/purchasing/orders' },
      { label: 'Goods Received', href: '/purchasing/receipts' },
    ],
  },
  {
    label: 'Counter POS',
    href: '/pos',
    icon: Monitor,
  },
  {
    label: 'Payments',
    icon: CreditCard,
    children: [
      { label: 'OneKhusa Status', href: '/payments/mobile-money' },
      { label: 'Card Reconciliation', href: '/payments/card-reconciliation' },
      { label: 'Bank Transfers', href: '/payments/bank-transfers' },
    ],
  },
  {
    label: 'Reports',
    icon: BarChart3,
    children: [
      { label: 'Sales Report', href: '/reports/sales' },
      { label: 'Stock Report', href: '/reports/stock' },
      { label: 'Profit Report', href: '/reports/profit' },
      { label: 'VAT Summary', href: '/reports/vat' },
      { label: 'Shift Reports', href: '/reports/shifts' },
    ],
  },
  {
    label: 'Settings',
    icon: Settings,
    children: [
      { label: 'Users', href: '/admin/users' },
      { label: 'App Settings', href: '/admin/settings' },
      { label: 'Locations', href: '/admin/locations' },
      { label: 'Audit Log', href: '/admin/audit-log' },
    ],
  },
];

function NavGroup({ item }: { item: NavItem }) {
  const pathname = usePathname() ?? '';

  const isChildActive = item.children?.some((c) => pathname.startsWith(c.href));
  const [open, setOpen] = useState(isChildActive ?? false);

  if (item.href) {
    const active = pathname === item.href || pathname.startsWith(item.href + '/');
    return (
      <Link
        href={item.href}
        className={cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
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

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
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
          {item.children?.map((child) => {
            const active = pathname === child.href || pathname.startsWith(child.href + '/');
            return (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
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

export function Sidebar() {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-gray-200 bg-white">
      {/* Logo area */}
      <div className="flex h-14 items-center border-b border-ace-band px-4">
        <div className="flex items-center gap-2">
          {/* Placeholder logo — replace with <Image> when ace-logo.png is supplied */}
          <div className="flex h-8 w-8 items-center justify-center rounded bg-ace-navy text-xs font-bold text-white">
            A
          </div>
          <div className="leading-tight">
            <p className="text-xs font-bold text-ace-navy-deep">ACE HOLDINGS</p>
            <p className="text-[10px] text-ace-muted">POS System</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="flex flex-col gap-0.5">
          {navGroups.map((item) => (
            <NavGroup key={item.label} item={item} />
          ))}
        </div>
      </nav>

      {/* Footer accent strip */}
      <div className="flex h-1.5 w-full">
        <div className="flex-1 bg-ace-blue" />
        <div className="flex-1 bg-ace-sky" />
        <div className="flex-1 bg-ace-cyan" />
      </div>
    </aside>
  );
}
