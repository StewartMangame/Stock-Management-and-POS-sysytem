/**
 * Customer Statement Report Service.
 *
 * Computes historical customer statements and running balances as of any date.
 *
 * Hotfix Rules (Phase 3):
 *   - Uses confirmed_at / reversed_at / voided_at for all point-in-time state.
 *   - No payment_status filter: queries strictly by point-in-time timestamps.
 *   - Statement lines contain pure document transactions:
 *       1. Invoices on issue_date
 *       2. Credit notes on issue_date
 *       3. Receipts on confirmed_at date
 *       4. Reversals as debit lines on reversed_at date
 *       5. Refunds on confirmed_at date
 *     NO allocation rows appear in statement lines.
 *   - awaiting_sale payments are strictly excluded.
 */

import { db } from '@/server/db';
import {
  customers,
  salesDocuments,
  payments,
  paymentAllocations,
} from '@/server/db/schema';
import { eq, and, sql, gte, lte, asc, isNotNull, ne } from 'drizzle-orm';
import { computeCustomerCreditAsOf } from '@/lib/payment-math';
import {
  todayInCompanyTz,
  startOfDayInCompanyTz,
  endOfDayInCompanyTz,
} from '@/lib/timezone';

export interface StatementLine {
  id: string;
  date: string;
  reference: string;
  type: 'invoice' | 'credit_note' | 'receipt' | 'refund' | 'reversal';
  description: string;
  debitMinor: number;
  creditMinor: number;
  runningBalanceMinor: number;
}

export interface CustomerStatementReport {
  customer: {
    id: string;
    name: string;
    accountNumber: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    taxNumber?: string | null;
  };
  period: {
    from: string;
    to: string;
  };
  generatedAt: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  totalDebitsMinor: number;
  totalCreditsMinor: number;
  lines: StatementLine[];
}

function toIsoDate(d: Date | string): string {
  if (typeof d === 'string') return d.split('T')[0] ?? d;
  return d.toISOString().split('T')[0] ?? '';
}

/**
 * Computes historical customer net balance as of a given date:
 * Net Balance = (Issued Invoices <= asOf - Credit Notes <= asOf)
 *             - (Confirmed Receipts <= asOf - Reversals <= asOf)
 *             + (Confirmed Refunds <= asOf)
 * Equals: Aged Debtors Total(asOf) - Customer Credit(asOf).
 */
export async function getCustomerNetBalanceAsOf(
  customerId: string,
  asOfDateStr: string,
): Promise<{
  netBalanceMinor: number;
  agedDebtorsTotalMinor: number;
  customerCreditMinor: number;
}> {
  const asOfEndOfDay = endOfDayInCompanyTz(asOfDateStr);

  // 1. Invoices issued on or before asOfDateStr, respecting voided_at
  const [invoicesRes] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${salesDocuments.totalMinor}), 0)`,
    })
    .from(salesDocuments)
    .where(
      and(
        eq(salesDocuments.customerId, customerId),
        eq(salesDocuments.documentType, 'invoice'),
        ne(salesDocuments.status, 'draft'),
        lte(salesDocuments.issueDate, asOfDateStr),
        sql`(${salesDocuments.status} != 'void' OR ${salesDocuments.voidedAt} > ${asOfEndOfDay})`,
      ),
    );

  // 2. Credit notes on or before asOfDateStr
  const [creditNotesRes] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${salesDocuments.totalMinor}), 0)`,
    })
    .from(salesDocuments)
    .where(
      and(
        eq(salesDocuments.customerId, customerId),
        eq(salesDocuments.documentType, 'credit_note'),
        eq(salesDocuments.status, 'issued'),
        lte(salesDocuments.issueDate, asOfDateStr),
      ),
    );

  // 3. Allocations on or before asOfEndOfDay for customer's invoices
  const [allocsRes] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${paymentAllocations.amountMinor}), 0)`,
    })
    .from(paymentAllocations)
    .innerJoin(salesDocuments, eq(paymentAllocations.invoiceId, salesDocuments.id))
    .where(
      and(
        eq(salesDocuments.customerId, customerId),
        lte(paymentAllocations.allocatedAt, asOfEndOfDay),
      ),
    );

  // 4. Receipts confirmed on or before asOfEndOfDay (excluding awaiting_sale)
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

  // 5. Reversals on or before asOfEndOfDay
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

  // 6. Refunds confirmed on or before asOfEndOfDay
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

  // 7. Allocations on or before asOfEndOfDay against confirmed receipts
  const [receiptAllocsRes] = await db
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

  const totalInvoices = parseInt(invoicesRes?.total ?? '0', 10);
  const totalCreditNotes = parseInt(creditNotesRes?.total ?? '0', 10);
  const totalInvoiceAllocs = parseInt(allocsRes?.total ?? '0', 10);

  const rawReceipts = BigInt(receiptsRes?.total ?? '0');
  const rawReversals = BigInt(reversalsRes?.total ?? '0');
  const confirmedReceipts = rawReceipts > rawReversals ? rawReceipts - rawReversals : BigInt(0);

  const confirmedRefunds = BigInt(refundsRes?.total ?? '0');
  const receiptAllocs = BigInt(receiptAllocsRes?.total ?? '0');

  const customerCredit = computeCustomerCreditAsOf(
    confirmedReceipts,
    receiptAllocs,
    confirmedRefunds,
  );

  const agedDebtorsTotal = Math.max(0, totalInvoices - totalCreditNotes - totalInvoiceAllocs);
  const netBalance = agedDebtorsTotal - Number(customerCredit);

  return {
    netBalanceMinor: netBalance,
    agedDebtorsTotalMinor: agedDebtorsTotal,
    customerCreditMinor: Number(customerCredit),
  };
}

export async function getCustomerStatement(
  customerId: string,
  fromInput: Date | string,
  toInput: Date | string,
): Promise<CustomerStatementReport> {
  const fromStr = toIsoDate(fromInput);
  const toStr = toIsoDate(toInput);

  // Load customer
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) {
    throw new Error(`Customer ${customerId} not found`);
  }

  // Calculate opening balance as of (from - 1 day)
  const fromStartUtc = startOfDayInCompanyTz(fromStr);
  const toEndUtc = endOfDayInCompanyTz(toStr);

  const dayBeforeFromDate = new Date(fromStartUtc.getTime() - 24 * 60 * 60 * 1000);
  const dayBeforeFromStr = todayInCompanyTz(dayBeforeFromDate);

  const openingStatus = await getCustomerNetBalanceAsOf(customerId, dayBeforeFromStr);
  const openingBalance = openingStatus.netBalanceMinor;

  // Fetch transactions within [fromStr, toStr]
  // 1. Invoices
  const invoices = await db
    .select()
    .from(salesDocuments)
    .where(
      and(
        eq(salesDocuments.customerId, customerId),
        eq(salesDocuments.documentType, 'invoice'),
        ne(salesDocuments.status, 'draft'),
        gte(salesDocuments.issueDate, fromStr),
        lte(salesDocuments.issueDate, toStr),
        sql`(${salesDocuments.status} != 'void' OR ${salesDocuments.voidedAt} > ${toEndUtc})`,
      ),
    );

  // 2. Credit Notes
  const creditNotes = await db
    .select()
    .from(salesDocuments)
    .where(
      and(
        eq(salesDocuments.customerId, customerId),
        eq(salesDocuments.documentType, 'credit_note'),
        eq(salesDocuments.status, 'issued'),
        gte(salesDocuments.issueDate, fromStr),
        lte(salesDocuments.issueDate, toStr),
      ),
    );

  // 3. Receipts & Refunds confirmed within period (NO status filter; exclude awaiting_sale)
  const periodPayments = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.customerId, customerId),
        ne(payments.status, 'awaiting_sale'),
        isNotNull(payments.confirmedAt),
        gte(payments.confirmedAt, fromStartUtc),
        lte(payments.confirmedAt, toEndUtc),
      ),
    );

  // 4. Reversed payments where reversed_at is within period
  const reversals = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.customerId, customerId),
        isNotNull(payments.reversedAt),
        gte(payments.reversedAt, fromStartUtc),
        lte(payments.reversedAt, toEndUtc),
      ),
    );

  // Assemble pure transaction lines (NO allocation rows)
  interface RawLine {
    date: string;
    timestamp: number;
    id: string;
    reference: string;
    type: 'invoice' | 'credit_note' | 'receipt' | 'refund' | 'reversal';
    description: string;
    debitMinor: number;
    creditMinor: number;
  }

  const rawLines: RawLine[] = [];

  for (const inv of invoices) {
    rawLines.push({
      id: inv.id,
      date: inv.issueDate,
      timestamp: startOfDayInCompanyTz(inv.issueDate).getTime(),
      reference: inv.documentNumber ?? 'INVOICE',
      type: 'invoice',
      description: 'Invoice',
      debitMinor: Number(inv.totalMinor),
      creditMinor: 0,
    });
  }

  for (const cn of creditNotes) {
    rawLines.push({
      id: cn.id,
      date: cn.issueDate,
      timestamp: startOfDayInCompanyTz(cn.issueDate).getTime(),
      reference: cn.documentNumber ?? 'CREDIT NOTE',
      type: 'credit_note',
      description: 'Credit Note',
      debitMinor: 0,
      creditMinor: Number(cn.totalMinor),
    });
  }

  for (const p of periodPayments) {
    const paymentDateStr = p.confirmedAt ? todayInCompanyTz(new Date(p.confirmedAt)) : p.paymentDate;
    const paymentTime = p.confirmedAt ? new Date(p.confirmedAt).getTime() : startOfDayInCompanyTz(paymentDateStr).getTime();

    if (p.kind === 'receipt') {
      rawLines.push({
        id: p.id,
        date: paymentDateStr,
        timestamp: paymentTime,
        reference: p.paymentNumber,
        type: 'receipt',
        description: `Payment Received (${p.method.replace('_', ' ')})`,
        debitMinor: 0,
        creditMinor: Number(p.amountMinor),
      });
    } else if (p.kind === 'refund') {
      rawLines.push({
        id: p.id,
        date: paymentDateStr,
        timestamp: paymentTime,
        reference: p.paymentNumber,
        type: 'refund',
        description: `Customer Refund (${p.method.replace('_', ' ')})`,
        debitMinor: Number(p.amountMinor),
        creditMinor: 0,
      });
    }
  }

  for (const rev of reversals) {
    const revDate = rev.reversedAt ? todayInCompanyTz(new Date(rev.reversedAt)) : rev.paymentDate;
    const revTime = rev.reversedAt ? new Date(rev.reversedAt).getTime() : startOfDayInCompanyTz(revDate).getTime();
    rawLines.push({
      id: rev.id + '-rev',
      date: revDate,
      timestamp: revTime,
      reference: rev.paymentNumber,
      type: 'reversal',
      description: `Payment Reversal: ${rev.reversalReason ?? 'Reversed'}`,
      debitMinor: Number(rev.amountMinor),
      creditMinor: 0,
    });
  }

  // Sort lines chronologically
  rawLines.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.timestamp - b.timestamp;
  });

  // Calculate running balances
  let currentRunning = openingBalance;
  let totalDebits = 0;
  let totalCredits = 0;

  const lines: StatementLine[] = [];

  for (const raw of rawLines) {
    currentRunning = currentRunning + raw.debitMinor - raw.creditMinor;
    totalDebits += raw.debitMinor;
    totalCredits += raw.creditMinor;

    lines.push({
      id: raw.id,
      date: raw.date,
      reference: raw.reference,
      type: raw.type,
      description: raw.description,
      debitMinor: raw.debitMinor,
      creditMinor: raw.creditMinor,
      runningBalanceMinor: currentRunning,
    });
  }

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      accountNumber: customer.accountNumber,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      taxNumber: customer.taxNumber,
    },
    period: {
      from: fromStr,
      to: toStr,
    },
    generatedAt: new Date().toISOString(),
    openingBalanceMinor: openingBalance,
    closingBalanceMinor: currentRunning,
    totalDebitsMinor: totalDebits,
    totalCreditsMinor: totalCredits,
    lines,
  };
}
