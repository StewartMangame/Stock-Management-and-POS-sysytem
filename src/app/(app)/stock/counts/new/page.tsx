import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { listLocations } from '@/server/services/stock/locations';
import { listProducts } from '@/server/services/stock/products';
import { Button } from '@/components/ui/button';
import { NewCountForm } from '../NewCountForm';

export const metadata: Metadata = { title: 'New Stock Count | Ace Holdings POS' };

export default async function NewStockCountPage() {
  try {
    await authorize(PERMISSIONS.STOCK_COUNT);
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
        <Link href="/stock/counts">
          <Button variant="ghost" size="sm">← Back</Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Start Stock Count</h1>
          <p className="text-sm text-ace-muted">Record physical counts — variances will be reconciled against live inventory under lock.</p>
        </div>
      </div>

      <NewCountForm locations={locationList} products={productList} />
    </div>
  );
}
