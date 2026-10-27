import type { Metadata } from 'next';
import { auth } from '@/auth';
import { AlertCircle, TrendingUp, FileText, Package, CreditCard } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Dashboard' };

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  id,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  id: string;
}) {
  return (
    <Card id={id}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-ace-muted">{title}</CardTitle>
        <Icon className="h-4 w-4 text-ace-sky" />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-ace-navy">{value}</p>
        <p className="mt-1 text-xs text-ace-muted">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-ace-navy">Dashboard</h1>
        <p className="text-sm text-ace-muted">
          Welcome back, {session?.user?.name ?? 'User'}
        </p>
      </div>

      {/* Setup notice */}
      <div className="flex items-start gap-3 rounded-lg border border-ace-band bg-ace-band p-4">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-ace-blue" />
        <div>
          <p className="text-sm font-medium text-ace-navy">System setup — Phase 0 complete</p>
          <p className="mt-0.5 text-sm text-ace-muted">
            Auth, roles, and settings are live. Phase 1 will add products, stock, and purchasing.
          </p>
        </div>
      </div>

      {/* KPI cards — placeholder values until Phase 1+ data exists */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          id="stat-today-sales"
          title="Today's Sales"
          value="MWK 0"
          subtitle="No sales recorded yet"
          icon={TrendingUp}
        />
        <StatCard
          id="stat-open-invoices"
          title="Outstanding Invoices"
          value="0"
          subtitle="No invoices yet"
          icon={FileText}
        />
        <StatCard
          id="stat-low-stock"
          title="Low Stock Alerts"
          value="0"
          subtitle="Stock module not yet active"
          icon={Package}
        />
        <StatCard
          id="stat-unreconciled"
          title="Unreconciled Payments"
          value="0"
          subtitle="Payments module not yet active"
          icon={CreditCard}
        />
      </div>
    </div>
  );
}
