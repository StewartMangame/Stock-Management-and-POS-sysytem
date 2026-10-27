import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { listLocations } from '@/server/services/stock/locations';
import { listProducts } from '@/server/services/stock/products';
import { Button } from '@/components/ui/button';
import { AdjustmentForm } from '../AdjustmentForm';

export const metadata: Metadata = { title: 'New Stock Adjustment | Ace Holdings POS' };

export default async function NewAdjustmentPage() {
  try {
    await authorize(PERMISSIONS.STOCK_ADJUST);
  } catch {
    redirect('/dashboard');
  }

  const [locationList, productList] = await Promise.all([
    listLocations(),
    listProducts({ isActive: true }),
  ]);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Link href="/stock/adjustments">
          <Button variant="ghost" size="sm">← Back</Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">New Stock Adjustment</h1>
          <p className="text-sm text-ace-muted">Record an authorised inward or outward stock change with reason code.</p>
        </div>
      </div>

      <AdjustmentForm locations={locationList} products={productList} />
    </div>
  );
}
