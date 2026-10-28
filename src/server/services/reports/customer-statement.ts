/**
 * Customer Statement Service.
 *
 * Implements:
 *   - Historical opening balance as of (from - 1 day)
 *   - Chronological transactions within period:
 *       - Invoices (debit full total)
 *       - Credit Notes (credit full total)
 *       - Confirmed Receipts (credit full amount, deposits included)
 *       - Confirmed Refunds (debit full amount)
 *       - Reversals (debit reversed amount on reversal date)
 *   - Running balance computation
 *   - Closing balance = Opening balance + period debits - period credits
 *   - Mathematical invariant:
 *       Closing Balance === Aged Debtors Total(to) - Customer Credit(to)
 */

import { db } from '@/server/db';
import {
  salesDocuments,
  payments,
  paymentAllocations,
  customers,
} from '@/server/db/schema';
import { eq, and, sql, lte, gte, asc } from 'drizzle-orm';
import { computeCustomerCreditAsOf } from '@/lib/payment-math';

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
 *             - (Confirmed Receipts <= asOf)
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
  const asOfEndOfDay = new Date(`${asOfDateStr}T23:59:59.999Z`);

  // 1. Invoices on or before asOfDateStr
  const [invoicesRes] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${salesDocuments.totalMinor}), 0)`,
    })
    .from(salesDocuments)
    .where(
      and(
        eq(salesDocuments.customerId, customerId),
        eq(salesDocuments.documentType, 'invoice'),
        eq(salesDocuments.status, 'issued'),
        lte(salesDocuments.issueDate, asOfDateStr),
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

  // 4. Confirmed receipts on or before asOfDateStr
  const [receiptsRes] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${payments.amountMinor}), 0)`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.customerId, customerId),
        eq(payments.kind, 'receipt'),
        eq(payments.status, 'confirmed'),
        lte(payments.paymentDate, asOfDateStr),
      ),
    );

  // 5. Confirmed refunds on or before asOfDateStr
  const [refundsRes] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${payments.amountMinor}), 0)`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.customerId, customerId),
        eq(payments.kind, 'refund'),
        eq(payments.status, 'confirmed'),
        lte(payments.paymentDate, asOfDateStr),
      ),
    );

  // 6. Allocations on or before asOfEndOfDay against confirmed receipts
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
        eq(payments.status, 'confirmed'),
        lte(paymentAllocations.allocatedAt, asOfEndOfDay),
      ),
    );

  const totalInvoices = parseInt(invoicesRes?.total ?? '0', 10);
  const totalCreditNotes = parseInt(creditNotesRes?.total ?? '0', 10);
  const totalInvoiceAllocs = parseInt(allocsRes?.total ?? '0', 10);

  const confirmedReceipts = BigInt(receiptsRes?.total ?? '0');
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
  const fromDate = new Date(`${fromStr}T00:00:00.000Z`);
  const dayBeforeFromDate = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000);
  const dayBeforeFromStr = dayBeforeFromDate.toISOString().split('T')[0] ?? '';

  const openingStatus = await getCustomerNetBalanceAsOf(customerId, dayBeforeFromStr);
  const openingBalance = openingStatus.netBalanceMinor;

  // Fetch all transactions within [fromStr, toStr]
  // 1. Invoices
  const invoices = await db
    .select()
    .from(salesDocuments)
    .where(
      and(
        eq(salesDocuments.customerId, customerId),
        eq(salesDocuments.documentType, 'invoice'),
        eq(salesDocuments.status, 'issued'),
        gte(salesDocuments.issueDate, fromStr),
        lte(salesDocuments.issueDate, toStr),
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

  // 3. Confirmed Payments (Receipts & Refunds)
  const periodPayments = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.customerId, customerId),
        eq(payments.status, 'confirmed'),
        gte(payments.paymentDate, fromStr),
        lte(payments.paymentDate, toStr),
      ),
    );

  // 4. Reversed payments where reversed_at is within period
  const toEndOfDay = new Date(`${toStr}T23:59:59.999Z`);
  const fromStartOfDay = new Date(`${fromStr}T00:00:00.000Z`);

  const reversals = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.customerId, customerId),
        eq(payments.status, 'reversed'),
        gte(payments.reversedAt, fromStartOfDay),
        lte(payments.reversedAt, toEndOfDay),
      ),
    );

  // Assemble unsequenced raw lines
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
      timestamp: new Date(inv.issueDate).getTime(),
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
      timestamp: new Date(cn.issueDate).getTime(),
      reference: cn.documentNumber ?? 'CREDIT NOTE',
      type: 'credit_note',
      description: 'Credit Note',
      debitMinor: 0,
      creditMinor: Number(cn.totalMinor),
    });
  }

  for (const p of periodPayments) {
    if (p.kind === 'receipt') {
      rawLines.push({
        id: p.id,
        date: p.paymentDate,
        timestamp: new Date(p.paymentDate).getTime(),
        reference: p.paymentNumber,
        type: 'receipt',
        description: `Payment Received (${p.method.replace('_', ' ')})`,
        debitMinor: 0,
        creditMinor: Number(p.amountMinor),
      });
    } else if (p.kind === 'refund') {
      rawLines.push({
        id: p.id,
        date: p.paymentDate,
        timestamp: new Date(p.paymentDate).getTime(),
        reference: p.paymentNumber,
        type: 'refund',
        description: `Customer Refund (${p.method.replace('_', ' ')})`,
        debitMinor: Number(p.amountMinor),
        creditMinor: 0,
      });
    }
  }

  for (const rev of reversals) {
    const revDate = rev.reversedAt ? toIsoDate(rev.reversedAt) : rev.paymentDate;
    rawLines.push({
      id: rev.id + '-rev',
      date: revDate,
      timestamp: rev.reversedAt ? rev.reversedAt.getTime() : new Date(revDate).getTime(),
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

  const closingBalance = currentRunning;

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
    closingBalanceMinor: closingBalance,
    totalDebitsMinor: totalDebits,
    totalCreditsMinor: totalCredits,
    lines,
  };
}
