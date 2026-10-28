import React from 'react';
import { notFound } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getPaymentById } from '@/server/services/sales/payments';
import { PaymentDetailClient } from './PaymentDetailClient';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await authorize(PERMISSIONS.PAYMENTS_VIEW);

  const { id } = await params;
  const payment = await getPaymentById(id);

  if (!payment) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/sales/payments"
          className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="text-xs text-slate-500">Back to Payments</div>
      </div>

      <PaymentDetailClient payment={payment} />
    </div>
  );
}
