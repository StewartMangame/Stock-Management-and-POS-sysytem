/**
 * Payments Received Report Service.
 *
 * Groups payments received across date range by date and payment method.
 * Includes transaction count and total amount in tambala.
 * Covers confirmed and reversed payments (status IN ('confirmed', 'reversed')).
 */

import { db } from '@/server/db';
import { payments, locations } from '@/server/db/schema';
import { eq, and, sql, gte, lte, inArray, asc } from 'drizzle-orm';

export interface MethodSummary {
  method: string;
  count: number;
  totalMinor: number;
}

export interface DailyPaymentSummary {
  date: string;
  methods: Record<string, { count: number; totalMinor: number }>;
  dailyTotalMinor: number;
  dailyCount: number;
}

export interface PaymentsReportResult {
  from: string;
  to: string;
  locationId?: string;
  generatedAt: string;
  days: DailyPaymentSummary[];
  methodTotals: Record<string, { count: number; totalMinor: number }>;
  grandTotalMinor: number;
  grandTotalCount: number;
}

function toIsoDate(d: Date | string): string {
  if (typeof d === 'string') return d.split('T')[0] ?? d;
  return d.toISOString().split('T')[0] ?? '';
}

export async function getPaymentsReport(
  fromInput: Date | string,
  toInput: Date | string,
  locationId?: string,
): Promise<PaymentsReportResult> {
  const fromStr = toIsoDate(fromInput);
  const toStr = toIsoDate(toInput);

  const conditions = [
    inArray(payments.status, ['confirmed', 'reversed']),
    gte(payments.paymentDate, fromStr),
    lte(payments.paymentDate, toStr),
  ];

  if (locationId) {
    conditions.push(eq(payments.locationId, locationId));
  }

  const rows = await db
    .select({
      paymentDate: payments.paymentDate,
      method: payments.method,
      count: sql<string>`COUNT(*)`,
      totalMinor: sql<string>`COALESCE(SUM(${payments.amountMinor}), 0)`,
    })
    .from(payments)
    .where(and(...conditions))
    .groupBy(payments.paymentDate, payments.method)
    .orderBy(asc(payments.paymentDate), asc(payments.method));

  const dayMap = new Map<string, DailyPaymentSummary>();
  const methodTotals: Record<string, { count: number; totalMinor: number }> = {};
  let grandTotalMinor = 0;
  let grandTotalCount = 0;

  for (const r of rows) {
    const date = r.paymentDate;
    const method = r.method;
    const count = parseInt(r.count, 10);
    const totalMinor = parseInt(r.totalMinor, 10);

    let day = dayMap.get(date);
    if (!day) {
      day = {
        date,
        methods: {},
        dailyTotalMinor: 0,
        dailyCount: 0,
      };
      dayMap.set(date, day);
    }

    day.methods[method] = { count, totalMinor };
    day.dailyTotalMinor += totalMinor;
    day.dailyCount += count;

    if (!methodTotals[method]) {
      methodTotals[method] = { count: 0, totalMinor: 0 };
    }
    methodTotals[method].count += count;
    methodTotals[method].totalMinor += totalMinor;

    grandTotalMinor += totalMinor;
    grandTotalCount += count;
  }

  return {
    from: fromStr,
    to: toStr,
    locationId,
    generatedAt: new Date().toISOString(),
    days: Array.from(dayMap.values()),
    methodTotals,
    grandTotalMinor,
    grandTotalCount,
  };
}
