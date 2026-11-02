/**
 * /admin/exceptions — Manager Exceptions Screen
 * Lists flagged payments requiring manual review.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { payments, customers } from '@/server/db/schema';
import { isNotNull, desc, eq } from 'drizzle-orm';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';

export const metadata: Metadata = { title: 'Payment Exceptions' };

function fmt(d: Date | null | string) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-MW', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtMWK(minor: number) {
  return `MWK ${(minor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function ExceptionsPage() {
  try {
    await authorize(PERMISSIONS.SETTINGS_MANAGE);
  } catch {
    redirect('/dashboard');
  }

  const flaggedPayments = await db
    .select({
      id: payments.id,
      paymentNumber: payments.paymentNumber,
      amountMinor: payments.amountMinor,
      method: payments.method,
      status: payments.status,
      flagType: payments.flagType,
      flagReason: payments.flagReason,
      flaggedAt: payments.flaggedAt,
      providerReference: payments.providerReference,
      customerName: customers.name,
    })
    .from(payments)
    .leftJoin(customers, eq(payments.customerId, customers.id))
    .where(isNotNull(payments.flagType))
    .orderBy(desc(payments.flaggedAt))
    .limit(200);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Payment Exceptions</h1>
          <p className="text-sm text-ace-muted">
            Payments flagged for manual review — {flaggedPayments.length} item
            {flaggedPayments.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {flaggedPayments.length === 0 ? (
        <div className="border rounded-lg p-12 text-center text-muted-foreground">
          <AlertTriangle className="h-10 w-10 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No flagged payments</p>
          <p className="text-sm mt-1">All payments are proceeding normally.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Flagged At</th>
                <th className="px-4 py-2 text-left font-medium">Payment #</th>
                <th className="px-4 py-2 text-left font-medium">Customer</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-left font-medium">Method</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Flag Type</th>
                <th className="px-4 py-2 text-left font-medium">Reason</th>
                <th className="px-4 py-2 text-left font-medium">Provider Ref</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {flaggedPayments.map((pmt) => (
                <tr key={pmt.id} className="hover:bg-amber-50/50 dark:hover:bg-amber-900/10">
                  <td className="px-4 py-2 whitespace-nowrap">{fmt(pmt.flaggedAt)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{pmt.paymentNumber}</td>
                  <td className="px-4 py-2">{pmt.customerName ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-medium">{fmtMWK(pmt.amountMinor)}</td>
                  <td className="px-4 py-2 capitalize">{pmt.method.replace('_', ' ')}</td>
                  <td className="px-4 py-2">
                    <Badge variant={pmt.status === 'confirmed' ? 'default' : 'secondary'}>
                      {pmt.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="destructive">{pmt.flagType}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs max-w-xs">{pmt.flagReason ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{pmt.providerReference ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

