import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { listSuppliers } from '@/server/services/purchasing/suppliers';
import { SuppliersTable } from './SuppliersTable';

export const metadata: Metadata = {
  title: 'Suppliers | Ace Holdings POS',
};

export default async function SuppliersPage() {
  try {
    await authorize(PERMISSIONS.SUPPLIERS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const suppliersList = await listSuppliers();

  return <SuppliersTable suppliers={suppliersList} />;
}
