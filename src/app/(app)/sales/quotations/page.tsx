import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { quotations, customers, quotationLines } from '@/server/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { QuotationsTable } from './QuotationsTable';

export const metadata: Metadata = {
  title: 'Quotations | Ace Holdings POS',
};

export default async function QuotationsPage() {
  try {
    await authorize(PERMISSIONS.QUOTATIONS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const rows = await db
    .select({
      id: quotations.id,
      quotationNumber: quotations.quotationNumber,
      customerName: customers.name,
      customerAccount: customers.accountNumber,
      quotationDate: quotations.quotationDate,
      validUntil: quotations.validUntil,
      status: quotations.status,
      totalMinor: quotations.totalMinor,
      linesCount: sql<string>`count(${quotationLines.id})`,
    })
    .from(quotations)
    .innerJoin(customers, eq(quotations.customerId, customers.id))
    .leftJoin(quotationLines, eq(quotations.id, quotationLines.quotationId))
    .groupBy(quotations.id, customers.name, customers.accountNumber)
    .orderBy(desc(quotations.createdAt));

  const items = rows.map((r) => ({
    id: r.id,
    quotationNumber: r.quotationNumber,
    customerName: r.customerName,
    customerAccount: r.customerAccount,
    quotationDate: r.quotationDate ? new Date(r.quotationDate).toISOString() : null,
    validUntil: r.validUntil ? new Date(r.validUntil).toISOString() : null,
    status: r.status,
    totalMinor: r.totalMinor,
    linesCount: parseInt(r.linesCount || '0', 10),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ace-navy">Quotations</h1>
        <p className="text-sm text-muted-foreground">
          Prepare proforma quotations, reserve inventory upon client acceptance, and seamlessly convert to invoices.
        </p>
      </div>

      <QuotationsTable quotations={items} />
    </div>
  );
}
