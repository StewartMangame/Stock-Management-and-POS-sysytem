import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { ImportClient } from './ImportClient';

export const metadata: Metadata = { title: 'Import Data | Ace Holdings POS' };

export default async function ImportDataPage() {
  try {
    await authorize(PERMISSIONS.PRODUCTS_MANAGE);
  } catch {
    redirect('/dashboard');
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Link href="/stock/products">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">CSV Data Import</h1>
          <p className="text-sm text-ace-muted">
            Batch import products catalog or opening stock inventory with all-or-nothing validation.
          </p>
        </div>
      </div>

      <ImportClient />
    </div>
  );
}
