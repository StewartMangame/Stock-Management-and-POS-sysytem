import type { Metadata } from 'next';
import Link from 'next/link';
import { currentUser } from '@/server/auth/authorize';
import { redirect } from 'next/navigation';
import {
  BarChart3, TrendingUp, Package, ShoppingCart, FileText,
  CreditCard, Shield, AlertCircle, Users, ClipboardList,
} from 'lucide-react';
import { PERMISSIONS } from '@/lib/permissions';

export const metadata: Metadata = { title: 'Reports Center' };

interface ReportLink {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredPermissions: string[];
  category: string;
}

const ALL_REPORTS: ReportLink[] = [
  {
    id: 'sales-by-item',
    title: 'Sales Report',
    description: 'Revenue by item, customer, cashier, location, day, month and payment method.',
    href: '/reports/sales',
    icon: ShoppingCart,
    requiredPermissions: [PERMISSIONS.REPORTS_VIEW],
    category: 'Sales',
  },
  {
    id: 'profit',
    title: 'Profit Report',
    description: 'Revenue at delivery minus cost of goods sold. Includes invoiced-not-yet-delivered.',
    href: '/reports/profit',
    icon: TrendingUp,
    requiredPermissions: [PERMISSIONS.REPORTS_COST],
    category: 'Sales',
  },
  {
    id: 'pipeline',
    title: 'Sales Pipeline',
    description: 'Open quotations, conversion rate, and expiring soon.',
    href: '/reports/pipeline',
    icon: FileText,
    requiredPermissions: [PERMISSIONS.REPORTS_VIEW],
    category: 'Sales',
  },
  {
    id: 'vat',
    title: 'VAT Summary',
    description: 'Output VAT by rate for the period. EIS status counts included.',
    href: '/reports/vat',
    icon: FileText,
    requiredPermissions: [PERMISSIONS.REPORTS_COST],
    category: 'Finance',
  },
  {
    id: 'aged-debtors',
    title: 'Aged Debtors',
    description: 'Historical point-in-time aging of outstanding customer accounts receivable.',
    href: '/reports/aged-debtors',
    icon: Users,
    requiredPermissions: [PERMISSIONS.REPORTS_VIEW],
    category: 'Receivables',
  },
  {
    id: 'customer-statement',
    title: 'Customer Statement',
    description: 'Running balance statement for a single customer over a period.',
    href: '/reports/customer-statement',
    icon: FileText,
    requiredPermissions: [PERMISSIONS.REPORTS_VIEW],
    category: 'Receivables',
  },
  {
    id: 'stock-on-hand',
    title: 'Stock On Hand',
    description: 'Current stock levels by location with valuation.',
    href: '/reports/stock',
    icon: Package,
    requiredPermissions: [PERMISSIONS.STOCK_VIEW],
    category: 'Stock',
  },
  {
    id: 'warranty',
    title: 'Warranty Report',
    description: 'Serials expiring in 30, 60 and 90 days by customer.',
    href: '/reports/warranty',
    icon: Shield,
    requiredPermissions: [PERMISSIONS.REPORTS_VIEW],
    category: 'Stock',
  },
  {
    id: 'purchasing',
    title: 'Purchasing Reports',
    description: 'Outstanding orders, goods received, and landed cost analysis.',
    href: '/reports/purchasing',
    icon: ClipboardList,
    requiredPermissions: [PERMISSIONS.PURCHASE_ORDERS_VIEW],
    category: 'Purchasing',
  },
  {
    id: 'payments-received',
    title: 'Payments Received',
    description: 'Daily payment collection analysis by method.',
    href: '/reports/payments-received',
    icon: CreditCard,
    requiredPermissions: [PERMISSIONS.PAYMENTS_VIEW],
    category: 'Payments',
  },
  {
    id: 'shifts',
    title: 'Shift Reports',
    description: 'Cashier shift summaries, cash-up variances and daily totals.',
    href: '/reports/shifts',
    icon: BarChart3,
    requiredPermissions: [PERMISSIONS.SHIFTS_MANAGE],
    category: 'Payments',
  },
  {
    id: 'controls',
    title: 'Controls & Exceptions',
    description: 'Discounts, voids, refunds, reversals, reprints and manager overrides.',
    href: '/reports/controls',
    icon: AlertCircle,
    requiredPermissions: [PERMISSIONS.REPORTS_COST],
    category: 'Controls',
  },
];

const CATEGORY_ORDER = ['Sales', 'Finance', 'Receivables', 'Stock', 'Purchasing', 'Payments', 'Controls'];

export default async function ReportsCenterPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const userPerms = user.role.permissions as string[];

  // Filter to reports the user can access
  const accessible = ALL_REPORTS.filter((r) =>
    r.requiredPermissions.every((p) => userPerms.includes(p)),
  );

  const byCategory = CATEGORY_ORDER.reduce<Record<string, ReportLink[]>>((acc, cat) => {
    const group = accessible.filter((r) => r.category === cat);
    if (group.length) acc[cat] = group;
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-ace-navy">Reports Center</h1>
        <p className="text-sm text-ace-muted mt-1">
          All figures are computed from historical records. Totals on screen equal CSV and PDF exports.
        </p>
      </div>

      {Object.entries(byCategory).map(([category, reports]) => (
        <section key={category}>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ace-muted mb-3">
            {category}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {reports.map((report) => {
              const Icon = report.icon;
              return (
                <Link
                  key={report.id}
                  href={report.href}
                  className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-ace-blue hover:shadow-md transition-all group"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ace-band text-ace-blue group-hover:bg-ace-blue group-hover:text-white transition-colors">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ace-navy">{report.title}</p>
                    <p className="mt-0.5 text-xs text-ace-muted">{report.description}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      {Object.keys(byCategory).length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-ace-muted">
          You don&apos;t have access to any reports. Contact your administrator.
        </div>
      )}
    </div>
  );
}

