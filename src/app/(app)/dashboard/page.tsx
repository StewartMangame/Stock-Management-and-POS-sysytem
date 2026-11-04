import type { Metadata } from 'next';
import Link from 'next/link';
import { auth } from '@/auth';
import {
  TrendingUp,
  FileText,
  Package,
  CreditCard,
  AlertTriangle,
  Clock,
  ShoppingCart,
  CheckCircle2,
  Receipt,
  FileCheck,
  ShieldAlert,
  ArrowRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/server/db';
import { users, roles } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import {
  getManagerDashboardData,
  getSalesDashboardData,
  getStorekeeperDashboardData,
  getCashierDashboardData,
  getViewerDashboardData,
} from '@/server/services/dashboard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dashboard — Ace Holdings' };

function fmtMWK(minor: number): string {
  return `MWK ${(minor / 100).toLocaleString('en-MW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const [userWithRole] = await db
    .select({
      id: users.id,
      name: users.name,
      roleName: roles.name,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, session.user.id))
    .limit(1);

  const role = userWithRole?.roleName ?? 'viewer';
  const userId = session.user.id;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ace-navy">Dashboard</h1>
          <p className="text-sm text-ace-muted">
            Welcome back, <span className="font-medium text-ace-navy">{session?.user?.name ?? 'User'}</span> ({role.toUpperCase()})
          </p>
        </div>
      </div>

      {/* Role-Specific View */}
      {(role === 'admin' || role === 'manager') && (
        <ManagerDashboard />
      )}

      {role === 'sales' && (
        <SalesDashboard userId={userId} />
      )}

      {role === 'storekeeper' && (
        <StorekeeperDashboard />
      )}

      {role === 'cashier' && (
        <CashierDashboard userId={userId} />
      )}

      {role === 'viewer' && (
        <ViewerDashboard />
      )}
    </div>
  );
}

// ── Manager & Admin Dashboard ─────────────────────────────────────────────────

async function ManagerDashboard() {
  const data = await getManagerDashboardData();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Sales Today */}
        <Link href="/reports/sales" className="transition hover:opacity-90">
          <Card className="h-full border-ace-band hover:border-ace-blue/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                Sales Today (Net)
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-ace-navy">{fmtMWK(data.salesToday.totalNetMinor)}</div>
              <p className="mt-1 text-xs text-ace-muted">
                Office: {fmtMWK(data.salesToday.officeNetMinor)} · Counter: {fmtMWK(data.salesToday.counterNetMinor)}
              </p>
              <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
                View Sales Report <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Outstanding Receivables */}
        <Link href="/reports/aged-debtors" className="transition hover:opacity-90">
          <Card className="h-full border-ace-band hover:border-ace-blue/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                Outstanding Receivables
              </CardTitle>
              <CreditCard className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-ace-navy">{fmtMWK(data.receivables.outstandingMinor)}</div>
              <p className="mt-1 text-xs text-amber-700">
                Overdue: {fmtMWK(data.receivables.overdueMinor)} ({data.receivables.overdueCount} accounts)
              </p>
              <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
                View Aged Debtors <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Low Stock Alerts */}
        <Link href="/reports/stock" className="transition hover:opacity-90">
          <Card className="h-full border-ace-band hover:border-ace-blue/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                Low Stock Alerts
              </CardTitle>
              <Package className="h-4 w-4 text-amber-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-ace-navy">{data.lowStockCount}</div>
              <p className="mt-1 text-xs text-ace-muted">
                Items at or below reorder threshold
              </p>
              <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
                View Stock Valuation <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Unreconciled Payments */}
        <Link href="/reports/payments-received" className="transition hover:opacity-90">
          <Card className="h-full border-ace-band hover:border-ace-blue/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                Unreconciled Payments
              </CardTitle>
              <Clock className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-ace-navy">{data.unreconciledPayments.count}</div>
              <p className="mt-1 text-xs text-ace-muted">
                Total: {fmtMWK(data.unreconciledPayments.totalMinor)} pending/unallocated
              </p>
              <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
                View Payments Report <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Pending EIS */}
        <Link href="/reports/vat" className="transition hover:opacity-90">
          <Card className="h-full border-ace-band hover:border-ace-blue/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                Pending EIS Submissions
              </CardTitle>
              <FileCheck className="h-4 w-4 text-sky-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-ace-navy">{data.pendingEisCount}</div>
              <p className="mt-1 text-xs text-ace-muted">
                Pending fiscalisation or retry
              </p>
              <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
                View VAT Summary <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Open Quotations */}
        <Link href="/reports/pipeline" className="transition hover:opacity-90">
          <Card className="h-full border-ace-band hover:border-ace-blue/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                Open Quotations
              </CardTitle>
              <FileText className="h-4 w-4 text-indigo-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-ace-navy">{data.openQuotations.count}</div>
              <p className="mt-1 text-xs text-ace-muted">
                Pipeline Value: {fmtMWK(data.openQuotations.totalMinor)}
              </p>
              <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
                View Pipeline Report <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Open Shifts & Variance */}
        <Link href="/pos/shifts" className="transition hover:opacity-90">
          <Card className="h-full border-ace-band hover:border-ace-blue/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                POS Shifts
              </CardTitle>
              <Receipt className="h-4 w-4 text-teal-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-ace-navy">{data.openShifts.openCount} Open</div>
              <p className="mt-1 text-xs text-ace-muted">
                Latest variance: {data.openShifts.latestVarianceMinor !== null ? fmtMWK(data.openShifts.latestVarianceMinor) : 'None'}
              </p>
              <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
                View POS Shifts <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Exceptions Count */}
        <Link href="/reports/controls" className="transition hover:opacity-90">
          <Card className="h-full border-ace-band hover:border-ace-blue/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                Exceptions & Overrides
              </CardTitle>
              <ShieldAlert className="h-4 w-4 text-rose-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-ace-navy">{data.exceptionsCount}</div>
              <p className="mt-1 text-xs text-ace-muted">
                Flagged events requiring review
              </p>
              <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
                View Controls Register <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}

// ── Sales Rep Dashboard ───────────────────────────────────────────────────────

async function SalesDashboard({ userId }: { userId: string }) {
  const data = await getSalesDashboardData(userId);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Link href="/sales/quotations" className="transition hover:opacity-90">
        <Card className="h-full border-ace-band hover:border-ace-blue/40">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
              My Open Quotations
            </CardTitle>
            <FileText className="h-4 w-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-ace-navy">{data.ownQuotations.count}</div>
            <p className="mt-1 text-xs text-ace-muted">
              Value: {fmtMWK(data.ownQuotations.totalMinor)}
            </p>
            <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
              Manage Quotations <ArrowRight className="h-3 w-3" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link href="/sales/invoices" className="transition hover:opacity-90">
        <Card className="h-full border-ace-band hover:border-ace-blue/40">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
              My Invoices Today
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-ace-navy">{data.ownInvoicesToday.count}</div>
            <p className="mt-1 text-xs text-ace-muted">
              Net: {fmtMWK(data.ownInvoicesToday.totalMinor)}
            </p>
            <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
              View Invoices <ArrowRight className="h-3 w-3" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link href="/reports/pipeline" className="transition hover:opacity-90">
        <Card className="h-full border-ace-band hover:border-ace-blue/40">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
              Pipeline Value
            </CardTitle>
            <CreditCard className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-ace-navy">{fmtMWK(data.pipelineValueMinor)}</div>
            <p className="mt-1 text-xs text-ace-muted">
              Total active quotation pipeline
            </p>
            <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
              View Pipeline Report <ArrowRight className="h-3 w-3" />
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

// ── Storekeeper Dashboard ─────────────────────────────────────────────────────

async function StorekeeperDashboard() {
  const data = await getStorekeeperDashboardData();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Link href="/reports/stock" className="transition hover:opacity-90">
        <Card className="h-full border-ace-band hover:border-ace-blue/40">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
              Low Stock Items
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-ace-navy">{data.lowStockCount}</div>
            <p className="mt-1 text-xs text-ace-muted">Items needing reorder</p>
            <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
              View Stock Report <ArrowRight className="h-3 w-3" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link href="/sales/delivery-notes" className="transition hover:opacity-90">
        <Card className="h-full border-ace-band hover:border-ace-blue/40">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
              Invoices Awaiting Delivery
            </CardTitle>
            <Package className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-ace-navy">{data.invoicesAwaitingDelivery}</div>
            <p className="mt-1 text-xs text-ace-muted">Undelivered sales documents</p>
            <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
              Dispatch Delivery <ArrowRight className="h-3 w-3" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link href="/purchasing/orders" className="transition hover:opacity-90">
        <Card className="h-full border-ace-band hover:border-ace-blue/40">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
              Purchase Orders to Receive
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-ace-navy">{data.purchaseOrdersToReceive}</div>
            <p className="mt-1 text-xs text-ace-muted">Approved orders awaiting goods receipt</p>
            <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
              Receive Goods <ArrowRight className="h-3 w-3" />
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

// ── Cashier Dashboard (Blind Cash-Up Enforced) ─────────────────────────────────

async function CashierDashboard({ userId }: { userId: string }) {
  const data = await getCashierDashboardData(userId);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Active Shift Card */}
        <Link href="/pos/shifts" className="transition hover:opacity-90">
          <Card className="h-full border-ace-band hover:border-ace-blue/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                Current Shift
              </CardTitle>
              <Clock className="h-4 w-4 text-ace-blue" />
            </CardHeader>
            <CardContent>
              {data.currentShift ? (
                <>
                  <div className="text-2xl font-bold text-ace-navy">{data.currentShift.shiftNumber}</div>
                  <p className="mt-1 text-xs text-emerald-700">Open since {data.currentShift.openedAt}</p>
                </>
              ) : (
                <>
                  <div className="text-xl font-medium text-amber-700">No Open Shift</div>
                  <p className="mt-1 text-xs text-ace-muted">Open a shift at the POS counter to begin</p>
                </>
              )}
              <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
                Shift Reconciliation <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Counter Sales Count */}
        <Link href="/pos" className="transition hover:opacity-90">
          <Card className="h-full border-ace-band hover:border-ace-blue/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                Completed Sales Today
              </CardTitle>
              <ShoppingCart className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-ace-navy">{data.salesCountToday}</div>
              <p className="mt-1 text-xs text-ace-muted">Transactions on your current shift</p>
              <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
                Go to Counter POS <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Items Sold */}
        <Link href="/pos" className="transition hover:opacity-90">
          <Card className="h-full border-ace-band hover:border-ace-blue/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
                Items Sold Today
              </CardTitle>
              <Package className="h-4 w-4 text-teal-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-ace-navy">{data.itemsSoldToday}</div>
              <p className="mt-1 text-xs text-ace-muted">Total units rung up at counter</p>
              <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
                New Sale <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Blind Cash-Up notice: No expected cash or drawer figures displayed */}
      <div className="rounded-lg border border-ace-band bg-ace-band/40 p-4 text-xs text-ace-muted">
        <span className="font-semibold text-ace-navy">Blind Cash-Up Policy Active:</span> Cash in drawer and expected amounts are hidden until after end-of-shift declaration.
      </div>
    </div>
  );
}

// ── Viewer Dashboard ──────────────────────────────────────────────────────────

async function ViewerDashboard() {
  const data = await getViewerDashboardData();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Link href="/reports/sales" className="transition hover:opacity-90">
        <Card className="h-full border-ace-band hover:border-ace-blue/40">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
              Sales Today (Net)
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-ace-navy">{fmtMWK(data.salesTodayNetMinor)}</div>
            <p className="mt-1 text-xs text-ace-muted">Company-wide net sales</p>
            <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
              View Sales Summary <ArrowRight className="h-3 w-3" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link href="/reports/stock" className="transition hover:opacity-90">
        <Card className="h-full border-ace-band hover:border-ace-blue/40">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
              Active Catalog Products
            </CardTitle>
            <Package className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-ace-navy">{data.activeProductsCount}</div>
            <p className="mt-1 text-xs text-ace-muted">Catalogue items listed</p>
            <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
              View Inventory List <ArrowRight className="h-3 w-3" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link href="/reports/stock" className="transition hover:opacity-90">
        <Card className="h-full border-ace-band hover:border-ace-blue/40">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ace-muted">
              Total Units On Hand
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-teal-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-ace-navy">{data.totalUnitsOnHand}</div>
            <p className="mt-1 text-xs text-ace-muted">Total physical inventory units</p>
            <div className="mt-3 flex items-center gap-1 text-xs font-medium text-ace-blue">
              Stock Breakdown <ArrowRight className="h-3 w-3" />
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
