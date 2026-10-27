import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { listCategories } from '@/server/services/stock/categories';
import { CategoriesTable } from './CategoriesTable';

export const metadata: Metadata = { title: 'Product Categories | Ace Holdings POS' };

export default async function CategoriesPage() {
  try {
    await authorize(PERMISSIONS.PRODUCTS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const categories = await listCategories();

  return (
    <div className="max-w-6xl mx-auto">
      <CategoriesTable categories={categories} />
    </div>
  );
}
