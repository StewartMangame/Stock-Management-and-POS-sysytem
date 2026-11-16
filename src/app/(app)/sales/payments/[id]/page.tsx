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
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <ChevronLeft className="w-5 h-5" />
          Back to Payments
        </Link>
      </div>

      <PaymentDetailClient payment={payment} />
    </div>
  );
}
