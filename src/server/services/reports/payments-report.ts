/**
 * Payments Received Report Service.
 *
 * Groups payments received across date range by local date (Africa/Blantyre) and payment method.
 * Includes transaction count and total amount in tambala.
 *
 * Hotfix Rules (Phase 3):
 *   - No payment_status filter: queries strictly by point-in-time timestamps (confirmed_at, reversed_at).
 *   - Confirmed receipts / refunds are grouped by local date of confirmed_at.
 *   - Reversals appear on the date of reversed_at as separate negative lines.
 *   - Payments in 'awaiting_sale' status are surfaced in a separate "received, not yet applied" section.
 */

import { db } from '@/server/db';
import { payments } from '@/server/db/schema';
import { eq, and, sql, gte, lte, isNotNull, asc } from 'drizzle-orm';
import {
  todayInCompanyTz,
  startOfDayInCompanyTz,
  endOfDayInCompanyTz,
} from '@/lib/timezone';

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

export interface UnappliedPaymentSummary {
  id: string;
  paymentNumber: string;
  method: string;
  amountMinor: number;
  receivedAt: string;
  locationId: string;
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
  receivedNotYetApplied: UnappliedPaymentSummary[];
  receivedNotYetAppliedTotalMinor: number;
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

  const startUtc = startOfDayInCompanyTz(fromStr);
  const endUtc = endOfDayInCompanyTz(toStr);

  // 1. Fetch confirmed payments by confirmed_at window (NO payment_status filter)
  const confirmedConditions = [
    isNotNull(payments.confirmedAt),
    gte(payments.confirmedAt, startUtc),
    lte(payments.confirmedAt, endUtc),
  ];
  if (locationId) confirmedConditions.push(eq(payments.locationId, locationId));

  const confirmedRows = await db
    .select({
      id: payments.id,
      method: payments.method,
      kind: payments.kind,
      amountMinor: payments.amountMinor,
      confirmedAt: payments.confirmedAt,
    })
    .from(payments)
    .where(and(...confirmedConditions))
    .orderBy(asc(payments.confirmedAt));

  // 2. Fetch reversals by reversed_at window
  const reversalConditions = [
    isNotNull(payments.reversedAt),
    gte(payments.reversedAt, startUtc),
    lte(payments.reversedAt, endUtc),
  ];
  if (locationId) reversalConditions.push(eq(payments.locationId, locationId));

  const reversalRows = await db
    .select({
      id: payments.id,
      method: payments.method,
      amountMinor: payments.amountMinor,
      reversedAt: payments.reversedAt,
    })
    .from(payments)
    .where(and(...reversalConditions))
    .orderBy(asc(payments.reversedAt));

  // 3. Fetch 'awaiting_sale' payments (received, not yet applied)
  const unappliedConditions = [
    eq(payments.status, 'awaiting_sale'),
  ];
  if (locationId) unappliedConditions.push(eq(payments.locationId, locationId));

  const unappliedRows = await db
    .select({
      id: payments.id,
      paymentNumber: payments.paymentNumber,
      method: payments.method,
      amountMinor: payments.amountMinor,
      createdAt: payments.createdAt,
      locationId: payments.locationId,
    })
    .from(payments)
    .where(and(...unappliedConditions))
    .orderBy(asc(payments.createdAt));

  const dayMap = new Map<string, DailyPaymentSummary>();
  const methodTotals: Record<string, { count: number; totalMinor: number }> = {};
  let grandTotalMinor = 0;
  let grandTotalCount = 0;

  // Process confirmed receipts (+) and refunds (-)
  for (const r of confirmedRows) {
    if (!r.confirmedAt) continue;
    const dateStr = todayInCompanyTz(new Date(r.confirmedAt));
    const method = r.method;
    const multiplier = r.kind === 'refund' ? -1 : 1;
    const lineAmount = Number(r.amountMinor) * multiplier;

    let day = dayMap.get(dateStr);
    if (!day) {
      day = { date: dateStr, methods: {}, dailyTotalMinor: 0, dailyCount: 0 };
      dayMap.set(dateStr, day);
    }

    if (!day.methods[method]) {
      day.methods[method] = { count: 0, totalMinor: 0 };
    }
    day.methods[method].count += 1;
    day.methods[method].totalMinor += lineAmount;
    day.dailyTotalMinor += lineAmount;
    day.dailyCount += 1;

    if (!methodTotals[method]) {
      methodTotals[method] = { count: 0, totalMinor: 0 };
    }
    methodTotals[method].count += 1;
    methodTotals[method].totalMinor += lineAmount;

    grandTotalMinor += lineAmount;
    grandTotalCount += 1;
  }

  // Process reversals as separate negative lines on reversed_at date
  for (const r of reversalRows) {
    if (!r.reversedAt) continue;
    const dateStr = todayInCompanyTz(new Date(r.reversedAt));
    const reversalMethodKey = `${r.method} (Reversal)`;
    const lineAmount = -Number(r.amountMinor);

    let day = dayMap.get(dateStr);
    if (!day) {
      day = { date: dateStr, methods: {}, dailyTotalMinor: 0, dailyCount: 0 };
      dayMap.set(dateStr, day);
    }

    if (!day.methods[reversalMethodKey]) {
      day.methods[reversalMethodKey] = { count: 0, totalMinor: 0 };
    }
    day.methods[reversalMethodKey].count += 1;
    day.methods[reversalMethodKey].totalMinor += lineAmount;
    day.dailyTotalMinor += lineAmount;
    day.dailyCount += 1;

    if (!methodTotals[reversalMethodKey]) {
      methodTotals[reversalMethodKey] = { count: 0, totalMinor: 0 };
    }
    methodTotals[reversalMethodKey].count += 1;
    methodTotals[reversalMethodKey].totalMinor += lineAmount;

    grandTotalMinor += lineAmount;
    grandTotalCount += 1;
  }

  // Build unapplied list
  const receivedNotYetApplied: UnappliedPaymentSummary[] = unappliedRows.map((u) => ({
    id: u.id,
    paymentNumber: u.paymentNumber,
    method: u.method,
    amountMinor: Number(u.amountMinor),
    receivedAt: u.createdAt.toISOString(),
    locationId: u.locationId,
  }));
  const receivedNotYetAppliedTotalMinor = receivedNotYetApplied.reduce(
    (sum, u) => sum + u.amountMinor,
    0,
  );

  return {
    from: fromStr,
    to: toStr,
    locationId,
    generatedAt: new Date().toISOString(),
    days: Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    methodTotals,
    grandTotalMinor,
    grandTotalCount,
    receivedNotYetApplied,
    receivedNotYetAppliedTotalMinor,
  };
}
