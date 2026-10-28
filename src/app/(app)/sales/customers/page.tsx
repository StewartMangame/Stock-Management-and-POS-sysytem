import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getCustomers } from '@/server/services/sales/customers';
import { CustomersTable } from './CustomersTable';

export const metadata: Metadata = {
  title: 'Customers | Ace Holdings POS',
};

export default async function CustomersPage() {
  try {
    await authorize(PERMISSIONS.CUSTOMERS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const customersList = await getCustomers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ace-navy">Customers</h1>
        <p className="text-sm text-muted-foreground">
          Manage corporate and individual accounts, credit limits, and view customer 360° histories.
        </p>
      </div>

      <CustomersTable customers={customersList} />
    </div>
  );
}
