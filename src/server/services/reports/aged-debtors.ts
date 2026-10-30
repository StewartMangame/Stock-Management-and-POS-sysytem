/**
 * Historical Aged Debtors Report Service.
 *
 * Requirements (Invariant 1 & Phase 3 Hotfix):
 *   Aged debtors as-of date must be computed from historical records,
 *   not from current balance_minor:
 *   - Invoices issued on or before asOf (status != 'void' OR voided_at > asOfEndOfDay, document_type = 'invoice')
 *   - Minus credit notes issued on or before asOf referencing the invoice
 *   - Minus payment allocations (positive & negative rows) with allocated_at <= asOfEndOfDay
 *   - Customer credit as-of is computed from receipts (confirmed_at <= asOf), refunds (confirmed_at <= asOf),
 *     and reversals (reversed_at <= asOf). No payment_status filter.
 *   - awaiting_sale payments are strictly excluded from AR and customer credit.
 */

import { db } from '@/server/db';
import {
  salesDocuments,
  paymentAllocations,
  payments,
  customers,
} from '@/server/db/schema';
import { eq, and, sql, lte, asc, inArray, isNotNull, ne } from 'drizzle-orm';
import {
  ageInvoiceBucket,
  computeCustomerCreditAsOf,
  type AgedBucketName,
} from '@/lib/payment-math';
import {
  todayInCompanyTz,
  endOfDayInCompanyTz,
} from '@/lib/timezone';

export interface CustomerAgedInvoice {
  invoiceId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  originalTotalMinor: number;
  creditedMinorAsOf: number;
  allocatedMinorAsOf: number;
  netBalanceMinor: number;
  bucket: AgedBucketName;
}

export interface CustomerAgedReportRow {
  customerId: string;
  customerName: string;
  accountNumber: string;
  creditLimitMinor: number;
  currentMinor: number;
  days1_30Minor: number;
  days31_60Minor: number;
  days61_90Minor: number;
  days90plusMinor: number;
  totalOutstandingMinor: number;
  customerCreditMinor: number;
  netDueMinor: number;
  invoices: CustomerAgedInvoice[];
}

export interface AgedDebtorsReport {
  asOf: string;
  locationId?: string;
  generatedAt: string;
  rows: CustomerAgedReportRow[];
  totals: {
    currentMinor: number;
    days1_30Minor: number;
    days31_60Minor: number;
    days61_90Minor: number;
    days90plusMinor: number;
    totalOutstandingMinor: number;
    customerCreditMinor: number;
    netDueMinor: number;
  };
}

export async function getAgedDebtors(
  asOfInput: Date | string,
  locationId?: string,
): Promise<AgedDebtorsReport> {
  const asOfDateStr =
    typeof asOfInput === 'string'
      ? asOfInput.split('T')[0]!
      : todayInCompanyTz(asOfInput);
  const asOfDate = new Date(`${asOfDateStr}T00:00:00+02:00`);
  const asOfEndOfDay = endOfDayInCompanyTz(asOfDateStr);

  // 1. Fetch valid invoices with issue_date <= asOfDateStr (respecting voided_at)
  const invoiceConditions = [
    eq(salesDocuments.documentType, 'invoice'),
    ne(salesDocuments.status, 'draft'),
    lte(salesDocuments.issueDate, asOfDateStr),
    sql`(${salesDocuments.status} != 'void' OR ${salesDocuments.voidedAt} > ${asOfEndOfDay})`,
  ];

  if (locationId) {
    invoiceConditions.push(eq(salesDocuments.locationId, locationId));
  }

  const invoices = await db
    .select({
      invoice: salesDocuments,
      customer: customers,
    })
    .from(salesDocuments)
    .innerJoin(customers, eq(salesDocuments.customerId, customers.id))
    .where(and(...invoiceConditions))
    .orderBy(asc(salesDocuments.issueDate), asc(salesDocuments.id));

  const invoiceIds = invoices.map((r) => r.invoice.id);

  // 2. Fetch credit notes issued on or before asOfDateStr referencing these invoices
  const creditNotesAsOf = invoiceIds.length > 0
    ? await db
        .select({
          sourceDocumentId: salesDocuments.sourceDocumentId,
          totalMinor: salesDocuments.totalMinor,
        })
        .from(salesDocuments)
        .where(
          and(
            eq(salesDocuments.documentType, 'credit_note'),
            eq(salesDocuments.status, 'issued'),
            lte(salesDocuments.issueDate, asOfDateStr),
            inArray(salesDocuments.sourceDocumentId, invoiceIds),
          ),
        )
    : [];

  const creditsByInvoice = new Map<string, number>();
  for (const cn of creditNotesAsOf) {
    if (cn.sourceDocumentId) {
      const prev = creditsByInvoice.get(cn.sourceDocumentId) ?? 0;
      creditsByInvoice.set(cn.sourceDocumentId, prev + Number(cn.totalMinor));
    }
  }

  // 3. Fetch allocations allocated on or before asOfEndOfDay for these invoices
  const allocsAsOf = invoiceIds.length > 0
    ? await db
        .select({
          invoiceId: paymentAllocations.invoiceId,
          amountMinor: paymentAllocations.amountMinor,
        })
        .from(paymentAllocations)
        .where(
          and(
            inArray(paymentAllocations.invoiceId, invoiceIds),
            lte(paymentAllocations.allocatedAt, asOfEndOfDay),
          ),
        )
    : [];

  const allocsByInvoice = new Map<string, number>();
  for (const al of allocsAsOf) {
    const prev = allocsByInvoice.get(al.invoiceId) ?? 0;
    allocsByInvoice.set(al.invoiceId, prev + Number(al.amountMinor));
  }

  // 4. Calculate historical customer credit as-of asOfDateStr
  const customerMap = new Map<string, typeof customers.$inferSelect>();
  for (const r of invoices) {
    customerMap.set(r.customer.id, r.customer);
  }

  // Calculate customer credit for each customer as-of (excluding awaiting_sale)
  const customerCreditMap = new Map<string, number>();
  for (const customerId of customerMap.keys()) {
    // Confirmed receipts on or before asOfEndOfDay
    const [receiptsRes] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${payments.amountMinor}), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.customerId, customerId),
          eq(payments.kind, 'receipt'),
          ne(payments.status, 'awaiting_sale'),
          isNotNull(payments.confirmedAt),
          lte(payments.confirmedAt, asOfEndOfDay),
        ),
      );

    // Reversals on or before asOfEndOfDay
    const [reversalsRes] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${payments.amountMinor}), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.customerId, customerId),
          isNotNull(payments.reversedAt),
          lte(payments.reversedAt, asOfEndOfDay),
        ),
      );

    // Confirmed refunds on or before asOfEndOfDay
    const [refundsRes] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${payments.amountMinor}), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.customerId, customerId),
          eq(payments.kind, 'refund'),
          ne(payments.status, 'awaiting_sale'),
          isNotNull(payments.confirmedAt),
          lte(payments.confirmedAt, asOfEndOfDay),
        ),
      );

    // Allocations on or before asOfEndOfDay for this customer's confirmed receipts
    const [allocsRes] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${paymentAllocations.amountMinor}), 0)`,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
      .where(
        and(
          eq(payments.customerId, customerId),
          eq(payments.kind, 'receipt'),
          ne(payments.status, 'awaiting_sale'),
          isNotNull(payments.confirmedAt),
          lte(paymentAllocations.allocatedAt, asOfEndOfDay),
        ),
      );

    const rawReceipts = BigInt(receiptsRes?.total ?? '0');
    const rawReversals = BigInt(reversalsRes?.total ?? '0');
    const receipts = rawReceipts > rawReversals ? rawReceipts - rawReversals : BigInt(0);

    const refunds = BigInt(refundsRes?.total ?? '0');
    const allocs = BigInt(allocsRes?.total ?? '0');

    const credit = computeCustomerCreditAsOf(receipts, allocs, refunds);
    customerCreditMap.set(customerId, Number(credit));
  }

  // 5. Build customer rows with aged buckets
  const customerRowsMap = new Map<string, CustomerAgedReportRow>();

  for (const r of invoices) {
    const inv = r.invoice;
    const cust = r.customer;

    const originalTotal = Number(inv.totalMinor);
    const creditedAsOf = creditsByInvoice.get(inv.id) ?? 0;
    const allocatedAsOf = allocsByInvoice.get(inv.id) ?? 0;
    const netBalance = originalTotal - creditedAsOf - allocatedAsOf;

    // Exclude fully credited invoices (or overpaid invoices that have 0 or negative balance)
    if (netBalance <= 0) {
      continue;
    }

    const bucket = ageInvoiceBucket(inv.dueDate, asOfDate);

    let custRow = customerRowsMap.get(cust.id);
    if (!custRow) {
      const creditMinor = customerCreditMap.get(cust.id) ?? 0;
      custRow = {
        customerId: cust.id,
        customerName: cust.name,
        accountNumber: cust.accountNumber,
        creditLimitMinor: Number(cust.creditLimitMinor),
        currentMinor: 0,
        days1_30Minor: 0,
        days31_60Minor: 0,
        days61_90Minor: 0,
        days90plusMinor: 0,
        totalOutstandingMinor: 0,
        customerCreditMinor: creditMinor,
        netDueMinor: 0,
        invoices: [],
      };
      customerRowsMap.set(cust.id, custRow);
    }

    // Add to bucket
    if (bucket === 'current') custRow.currentMinor += netBalance;
    else if (bucket === 'days1_30') custRow.days1_30Minor += netBalance;
    else if (bucket === 'days31_60') custRow.days31_60Minor += netBalance;
    else if (bucket === 'days61_90') custRow.days61_90Minor += netBalance;
    else if (bucket === 'days90plus') custRow.days90plusMinor += netBalance;

    custRow.totalOutstandingMinor += netBalance;
    custRow.netDueMinor = Math.max(0, custRow.totalOutstandingMinor - custRow.customerCreditMinor);

    custRow.invoices.push({
      invoiceId: inv.id,
      invoiceNumber: inv.documentNumber ?? '',
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      originalTotalMinor: originalTotal,
      creditedMinorAsOf: creditedAsOf,
      allocatedMinorAsOf: allocatedAsOf,
      netBalanceMinor: netBalance,
      bucket,
    });
  }

  const rows = Array.from(customerRowsMap.values());

  // 6. Compute grand totals
  const totals = rows.reduce(
    (acc, row) => {
      acc.currentMinor += row.currentMinor;
      acc.days1_30Minor += row.days1_30Minor;
      acc.days31_60Minor += row.days31_60Minor;
      acc.days61_90Minor += row.days61_90Minor;
      acc.days90plusMinor += row.days90plusMinor;
      acc.totalOutstandingMinor += row.totalOutstandingMinor;
      acc.customerCreditMinor += row.customerCreditMinor;
      acc.netDueMinor += row.netDueMinor;
      return acc;
    },
    {
      currentMinor: 0,
      days1_30Minor: 0,
      days31_60Minor: 0,
      days61_90Minor: 0,
      days90plusMinor: 0,
      totalOutstandingMinor: 0,
      customerCreditMinor: 0,
      netDueMinor: 0,
    },
  );

  return {
    asOf: asOfDateStr,
    locationId,
    generatedAt: new Date().toISOString(),
    rows,
    totals,
  };
}
