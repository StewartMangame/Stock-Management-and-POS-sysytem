import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { listUnitsOfMeasure } from '@/server/services/stock/uom';
import { UomTable } from './UomTable';

export const metadata: Metadata = { title: 'Units of Measure | Ace Holdings POS' };

export default async function UnitsPage() {
  try {
    await authorize(PERMISSIONS.PRODUCTS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const units = await listUnitsOfMeasure();

  return (
    <div className="max-w-6xl mx-auto">
      <UomTable units={units} />
    </div>
  );
}
