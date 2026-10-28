import React from 'react';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getCustomers } from '@/server/services/sales/customers';
import { getLocations } from '@/server/services/locations';
import { getCardTerminals } from '@/server/services/setup/card-terminals';
import { PaymentForm } from './PaymentForm';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export default async function NewPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{
    customerId?: string;
    invoiceId?: string;
  }>;
}) {
  await authorize(PERMISSIONS.PAYMENTS_RECORD);

  const params = await searchParams;
  const rawCustomers = await getCustomers({ isActive: true });
  const rawLocations = await getLocations();
  const rawTerminals = await getCardTerminals({ isActive: true });

  const customersList = rawCustomers.map((c) => ({
    id: c.id,
    name: c.name,
    accountNumber: c.accountNumber,
    isWalkIn: c.isWalkIn,
  }));

  const locationsList = rawLocations.map((l) => ({
    id: l.id,
    name: l.name,
    code: l.code,
  }));

  const terminalsList = rawTerminals.map((t) => ({
    id: t.terminal.id,
    name: t.terminal.name,
    terminalId: t.terminal.terminalId,
    locationId: t.terminal.locationId,
    isActive: t.terminal.isActive,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/sales/payments"
          className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Record New Payment
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Enter payment details, capture payment method data, and allocate to outstanding customer invoices.
          </p>
        </div>
      </div>

      <PaymentForm
        customersList={customersList}
        locationsList={locationsList}
        terminalsList={terminalsList}
        preselectedCustomerId={params.customerId}
        preselectedInvoiceId={params.invoiceId}
      />
    </div>
  );
}
